import { AUDIO_RATE } from '../../src/server/wire';

const LEAD = 0.05;      // seconds of safety when starting after silence
const MAX_AHEAD = 0.4;  // never queue more than this (keeps sound close to the picture)

/** When the next chunk should start playing, or null to drop it because too much is queued already. */
export function nextStart(now: number, lastEnd: number): number | null {
  if (lastEnd < now + LEAD / 2) return now + LEAD;
  if (lastEnd - now > MAX_AHEAD) return null;
  return lastEnd;
}

const load = (k: string, d: number) => { try { const v = localStorage.getItem(k); return v === null ? d : +v; } catch { return d; } };
const store = (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* private window: keep going without it */ } };

/** Plays the game's sound as it arrives from the server. */
export class GameAudio {
  private ctx: AudioContext;
  private gain: GainNode;
  private lastEnd = 0;
  volume = load('volume', 0.6);
  muted = load('muted', 0) === 1;

  constructor(ctx?: AudioContext) {
    this.ctx = ctx ?? new AudioContext({ latencyHint: 'interactive' });
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.apply();
  }

  /** Browsers keep audio suspended until the first click or key press on the page. */
  get needsGesture(): boolean { return this.ctx.state !== 'running'; }
  resume(): Promise<void> { return this.ctx.resume(); }

  private apply() { this.gain.gain.value = this.muted ? 0 : this.volume; }
  setVolume(v: number) { this.volume = Math.max(0, Math.min(1, v)); store('volume', this.volume); this.apply(); }
  setMuted(m: boolean) { this.muted = m; store('muted', m ? 1 : 0); this.apply(); }

  /** One chunk of interleaved stereo 16-bit samples. */
  push(pcm: Int16Array) {
    if (this.needsGesture) return;
    const at = nextStart(this.ctx.currentTime, this.lastEnd);
    if (at === null) return;
    const n = pcm.length >> 1;
    const buf = this.ctx.createBuffer(2, n, AUDIO_RATE);
    const l = buf.getChannelData(0), r = buf.getChannelData(1);
    for (let i = 0; i < n; i++) { l[i] = pcm[2 * i] / 32768; r[i] = pcm[2 * i + 1] / 32768; }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    src.start(at);
    this.lastEnd = at + buf.duration;
  }
}
