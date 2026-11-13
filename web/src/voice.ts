import { VOICE_RATE } from '../../src/server/wire';

/**
 * The Pokédex sound: a small, band-limited speaker with a metallic warble and a little digital
 * crunch. Tuned by ear; see the Voice tuner page.
 */
export const VOICE_FX = { lowCut: 300, highCut: 3400, ringHz: 50, ringMix: 0.35, hold: 2 };
/** The voice still counts as talking this long after it ends, to cover dictation's delay. */
export const SPEAKING_TAIL_MS = 1500;
/** Seconds of safety when the first clip starts. */
const LEAD = 0.05;

/** The slice of AudioContext the player uses (so tests can stand in for it). */
export type AudioContextLike = Pick<BaseAudioContext, 'state' | 'currentTime' | 'destination' | 'createBuffer' | 'createBufferSource' | 'createGain' | 'createBiquadFilter' | 'createOscillator'>;

/** Samples as -1…1, each `hold`-th one held over the next ones (a lower-quality, crunchier sound). */
export function crush(pcm: Int16Array, hold: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(pcm.length);
  const h = Math.max(1, Math.floor(hold));
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i - (i % h)] / 32768;
  return out;
}

const load = (k: string, d: number) => { try { const v = localStorage.getItem(k); return v === null ? d : +v; } catch { return d; } };
const store = (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* private window: keep going without it */ } };

/** Plays spoken answers, in order, through the Pokédex effect. Dips the game music while it talks. */
export class VoicePlayer {
  enabled = load('voiceOn', 1) === 1;
  volume = load('voiceVolume', 0.8);
  /** called when `speaking` may have changed */
  onChange: (() => void) | null = null;

  private input: GainNode;
  private out: GainNode;
  private playing = new Set<AudioBufferSourceNode>();
  private lastEnd = 0;
  private endedAt = -Infinity;
  private tailTimer: ReturnType<typeof setTimeout> | null = null;
  private browserTalking = false;

  constructor(private ctx: AudioContextLike, private duck: (on: boolean) => void, private now: () => number = () => performance.now()) {
    const fx = VOICE_FX;
    this.input = ctx.createGain();
    const low = ctx.createBiquadFilter(); low.type = 'highpass'; low.frequency.value = fx.lowCut;
    const high = ctx.createBiquadFilter(); high.type = 'lowpass'; high.frequency.value = fx.highCut;
    const dry = ctx.createGain(); dry.gain.value = 1 - fx.ringMix;
    this.out = ctx.createGain();
    this.input.connect(low); low.connect(high); high.connect(dry); dry.connect(this.out);
    if (fx.ringHz > 0 && fx.ringMix > 0) {
      // ring modulation: the voice multiplied by a slow wave gives the metallic warble
      const ring = ctx.createGain(); ring.gain.value = 0;
      const osc = ctx.createOscillator(); osc.frequency.value = fx.ringHz;
      const depth = ctx.createGain(); depth.gain.value = fx.ringMix;
      osc.connect(depth); depth.connect(ring.gain); high.connect(ring); ring.connect(this.out);
      osc.start();
    }
    this.out.connect(ctx.destination);
    this.apply();
  }

  /** True while the voice talks and for SPEAKING_TAIL_MS after. */
  get speaking(): boolean {
    return this.playing.size > 0 || this.browserTalking || this.now() < this.endedAt + SPEAKING_TAIL_MS;
  }

  private apply() { this.out.gain.value = this.volume; }
  setVolume(v: number) { this.volume = Math.max(0, Math.min(1, v)); store('voiceVolume', this.volume); this.apply(); }
  setEnabled(on: boolean) { this.enabled = on; store('voiceOn', on ? 1 : 0); if (!on) this.stop(); }

  /** One spoken sentence: mono 16-bit at VOICE_RATE. */
  push(pcm: Int16Array) {
    // until the first click or key press the browser holds sound back, and a clip would never end
    if (!this.enabled || !pcm.length || this.ctx.state !== 'running') return;
    const buf = this.ctx.createBuffer(1, pcm.length, VOICE_RATE);
    buf.copyToChannel(crush(pcm, VOICE_FX.hold), 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.input);
    const at = Math.max(this.ctx.currentTime + LEAD, this.lastEnd);
    src.start(at);
    this.lastEnd = at + buf.duration;
    src.onended = () => { this.playing.delete(src); if (!this.playing.size) this.finished(true); };
    this.started();
    this.playing.add(src);
  }

  /** Reads text with the browser's own voice, for when the server cannot speak. */
  sayFallback(text: string) {
    if (!this.enabled || typeof speechSynthesis === 'undefined' || !text.trim()) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05; u.pitch = 0.6; u.volume = this.volume;
    u.onend = u.onerror = () => { if (this.browserTalking) { this.browserTalking = false; this.finished(true); } };
    this.started();
    this.browserTalking = true;
    speechSynthesis.speak(u);
  }

  /** Silence now: cut the clip playing, drop the rest. Dictation is let through at once. */
  stop() {
    const was = this.playing.size > 0 || this.browserTalking;
    for (const src of this.playing) { src.onended = null; try { src.stop(); } catch { /* not started yet */ } }
    this.playing.clear();
    this.lastEnd = 0;
    if (this.browserTalking || typeof speechSynthesis !== 'undefined') { try { speechSynthesis.cancel(); } catch { /* none */ } }
    this.browserTalking = false;
    if (was) this.finished(false);
    this.endedAt = -Infinity;
    this.onChange?.();
  }

  private started() {
    if (this.playing.size === 0 && !this.browserTalking) { this.duck(true); }
    if (this.tailTimer) { clearTimeout(this.tailTimer); this.tailTimer = null; }
    this.onChange?.();
  }
  private finished(tail: boolean) {
    this.duck(false);
    this.lastEnd = 0;
    if (tail) {
      this.endedAt = this.now();
      this.tailTimer = setTimeout(() => { this.tailTimer = null; this.onChange?.(); }, SPEAKING_TAIL_MS + 20);
    }
    this.onChange?.();
  }
}
