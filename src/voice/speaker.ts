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

/** The Mac's voice when this machine has one, otherwise null (the page then uses the browser's voice). */
export function findSpeaker(): SpeakerLike | null {
  return process.platform === 'darwin' && fs.existsSync('/usr/bin/say') ? new MacSpeaker() : null;
}
