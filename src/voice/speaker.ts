// Speaking a sentence with the Mac's own voice (`say`), as raw samples the page can play.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VOICE_RATE } from '../server/wire.js';

/** Turns one sentence into mono 16-bit samples at VOICE_RATE, or null if it could not. */
export interface SpeakerLike {
  speak(text: string): Promise<Int16Array | null>;
}

/** Runs a program with `input` on its standard input. Tests stand in for it. */
export type Runner = (file: string, args: string[], input: string, timeoutMs: number) => Promise<void>;

const runProgram: Runner = (file, args, input, timeoutMs) => new Promise((resolve, reject) => {
  const child = execFile(file, args, { timeout: timeoutMs }, (err) => (err ? reject(err) : resolve()));
  child.stdin?.end(input);
});

/** The samples of a mono, 16-bit, VOICE_RATE WAV file, or null for anything else. */
export function parseWav(buf: Uint8Array): Int16Array | null {
  if (buf.length < 12) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let fmtOk = false;
  for (let o = 12; o + 8 <= buf.length; ) {
    const id = tag(o), n = v.getUint32(o + 4, true), body = o + 8;
    if (id === 'fmt ') {
      fmtOk = v.getUint16(body, true) === 1 && v.getUint16(body + 2, true) === 1 && v.getUint32(body + 4, true) === VOICE_RATE && v.getUint16(body + 14, true) === 16;
      if (!fmtOk) return null;
    } else if (id === 'data') {
      if (!fmtOk) return null;
      const len = (Math.min(body + n, buf.length) - body) >> 1;
      const out = new Int16Array(len);
      for (let i = 0; i < len; i++) out[i] = v.getInt16(body + i * 2, true);
      return out;
    }
    o = body + n + (n & 1);
  }
  return null;
}

/** Speaks with macOS `say`. The text goes in on standard input, so it can never be read as options. */
export class MacSpeaker implements SpeakerLike {
  readonly voice: string;
  private timeoutMs: number;
  private run: Runner;

  constructor(opts: { voice?: string; timeoutMs?: number; run?: Runner } = {}) {
    const asked = opts.voice ?? process.env.SPEAK_VOICE ?? 'Fred';
    this.voice = /^[A-Za-z][A-Za-z ()]{0,39}$/.test(asked) ? asked : 'Fred';
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.run = opts.run ?? runProgram;
  }

  async speak(text: string): Promise<Int16Array | null> {
    const out = path.join(os.tmpdir(), `jev-voice-${randomUUID()}.wav`);
    const remove = () => { try { fs.rmSync(out, { force: true }); } catch { /* nothing to remove */ } };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const running = this.run('say', ['-v', this.voice, '-f', '-', '-o', out, `--data-format=LEI16@${VOICE_RATE}`], text, this.timeoutMs);
    try {
      const slow = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`took longer than ${this.timeoutMs} ms`)), this.timeoutMs); });
      await Promise.race([running, slow]);
      return parseWav(new Uint8Array(fs.readFileSync(out)));
    } catch (e) {
      // a `say` that was cut off may still write the file a moment later: remove it again once it has ended
      running.then(remove, remove);
      console.error(`[voice] ${(e as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
      remove();
    }
  }
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Speaks with Cartesia's cloud voices. The sentence is sent to Cartesia; raw samples come back.
 * The page adds the Pokédex effect on top, as it does for the Mac voice.
 */
export class CartesiaSpeaker implements SpeakerLike {
  /** "Quentin": a measured, even narrator, which suits an encyclopedia once the effect is on */
  static readonly DEFAULT_VOICE = '5568a7df-e5ab-4442-9fae-2e9ba1b15ad8';
  static readonly API_VERSION = '2026-08-14';
  readonly voice: string;
  readonly model: string;
  private apiKey: string;
  private timeoutMs: number;
  private fetch: Fetch;

  constructor(opts: { apiKey: string; voice?: string; model?: string; timeoutMs?: number; fetch?: Fetch }) {
    this.apiKey = opts.apiKey;
    const voice = opts.voice ?? process.env.CARTESIA_VOICE ?? '';
    this.voice = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(voice) ? voice : CartesiaSpeaker.DEFAULT_VOICE;
    this.model = opts.model ?? (process.env.CARTESIA_MODEL || 'sonic-3.6');
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.fetch = opts.fetch ?? ((url, init) => fetch(url, init));
  }

  async speak(text: string): Promise<Int16Array | null> {
    try {
      const res = await this.fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Cartesia-Version': CartesiaSpeaker.API_VERSION, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_id: this.model, transcript: text, voice: { id: this.voice }, language: 'en',
          output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: VOICE_RATE },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) {
        const why = (await res.text().catch(() => '')).slice(0, 200).split(this.apiKey).join('…');
        throw new Error(`Cartesia said ${res.status}${why ? `: ${why}` : ''}`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const out = new Int16Array(bytes.length >> 1);
      for (let i = 0; i < out.length; i++) out[i] = v.getInt16(i * 2, true);
      return out;
    } catch (e) {
      console.error(`[voice] ${(e as Error).message.split(this.apiKey).join('…')}`);
      return null;
    }
  }
}

/**
 * What speaks answers: Cartesia when CARTESIA_API_KEY is set, otherwise the Mac's own voice, otherwise
 * null (the page then uses the browser's voice).
 */
export function findSpeaker(env: Record<string, string | undefined> = process.env): SpeakerLike | null {
  if (env.CARTESIA_API_KEY) return new CartesiaSpeaker({ apiKey: env.CARTESIA_API_KEY });
  return process.platform === 'darwin' && fs.existsSync('/usr/bin/say') ? new MacSpeaker() : null;
}
