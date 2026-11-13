// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { crush, VoicePlayer, SPEAKING_TAIL_MS, type AudioContextLike } from './voice';

/** Just enough of an AudioContext to see what the player schedules. */
function fakeCtx() {
  const sources: { at: number; stopped: boolean; onended: (() => void) | null; end(): void }[] = [];
  const param = () => ({ value: 0, setTargetAtTime: vi.fn() });
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: param(), frequency: param(), type: '', start: vi.fn(), stop: vi.fn() });
  const ctx = {
    currentTime: 10, destination: {}, state: 'running',
    createBuffer: (_ch: number, n: number, rate: number) => ({ duration: n / rate, getChannelData: () => new Float32Array(n), copyToChannel: vi.fn() }),
    createBufferSource: () => {
      const s: any = { ...node(), buffer: null, onended: null, at: -1, stopped: false };
      s.start = (at: number) => { s.at = at; };
      s.stop = () => { s.stopped = true; };
      s.end = () => s.onended?.();
      sources.push(s);
      return s;
    },
    createGain: node, createBiquadFilter: node, createOscillator: node,
  };
  return { ctx: ctx as unknown as AudioContextLike, sources };
}
const clip = (n: number) => new Int16Array(n);

let f: ReturnType<typeof fakeCtx>, ducks: boolean[], clock: number, p: VoicePlayer;
beforeEach(() => {
  localStorage.clear();
  f = fakeCtx(); ducks = []; clock = 1000;
  p = new VoicePlayer(f.ctx, (on) => ducks.push(on), () => clock);
});
const endAll = () => f.sources.forEach((s) => s.end());

describe('crush', () => {
  it('holds every nth sample', () => expect(Array.from(crush(Int16Array.of(32767, 0, -32768, 0), 2))).toEqual([32767 / 32768, 32767 / 32768, -1, -1]));
  it('leaves the sound alone at 1', () => expect(Array.from(crush(Int16Array.of(16384, -16384), 1))).toEqual([0.5, -0.5]));
});

describe('VoicePlayer', () => {
  it('plays clips back to back', () => {
    p.push(clip(22050)); p.push(clip(11025));
    expect(f.sources.map((s) => s.at)).toEqual([10.05, 11.05]);
  });
  it('dips the music while speaking and lifts it after the last clip', () => {
    p.push(clip(100)); p.push(clip(100));
    expect(ducks).toEqual([true]);
    f.sources[0].end();
    expect(ducks).toEqual([true]);
    f.sources[1].end();
    expect(ducks).toEqual([true, false]);
  });
  it(`counts as speaking for ${SPEAKING_TAIL_MS} ms after the last clip`, () => {
    expect(p.speaking).toBe(false);
    p.push(clip(100));
    expect(p.speaking).toBe(true);
    endAll();
    clock += SPEAKING_TAIL_MS - 1;
    expect(p.speaking).toBe(true);
    clock += 2;
    expect(p.speaking).toBe(false);
  });
  it('ignores clips while the browser still holds sound back, so dictation is never blocked', () => {
    (f.ctx as any).state = 'suspended';
    p.push(clip(100));
    expect(f.sources).toEqual([]);
    expect(p.speaking).toBe(false);
  });
  it('ignores clips when Voice is off', () => {
    p.setEnabled(false);
    p.push(clip(100));
    expect(f.sources).toEqual([]);
    expect(p.speaking).toBe(false);
  });
  it('turning Voice off mid-answer stops it', () => {
    p.push(clip(100));
    p.setEnabled(false);
    expect(f.sources[0].stopped).toBe(true);
  });
  it('stop cuts the clip, empties the queue, and lets dictation through at once', () => {
    p.push(clip(100)); p.push(clip(100));
    p.stop();
    expect(f.sources.filter((s) => s.stopped)).toHaveLength(2);
    expect(ducks.at(-1)).toBe(false);
    expect(p.speaking).toBe(false);
    p.push(clip(100));
    expect(f.sources[2].at).toBe(10.05);
  });
  it('remembers the voice switch and volume', () => {
    p.setVolume(0.4); p.setEnabled(false);
    const q = new VoicePlayer(fakeCtx().ctx, () => {});
    expect(q.volume).toBe(0.4);
    expect(q.enabled).toBe(false);
  });
  it('reads with the browser voice when asked, and stop cancels it', () => {
    const speak = vi.fn(), cancel = vi.fn();
    (globalThis as any).speechSynthesis = { speak, cancel };
    (globalThis as any).SpeechSynthesisUtterance = class { text: string; constructor(t: string) { this.text = t; } };
    p.sayFallback('Water beats Rock.');
    expect(speak.mock.calls[0][0].text).toBe('Water beats Rock.');
    p.stop();
    expect(cancel).toHaveBeenCalled();
    p.setEnabled(false);
    p.sayFallback('Again.');
    expect(speak).toHaveBeenCalledTimes(1);
  });
});
