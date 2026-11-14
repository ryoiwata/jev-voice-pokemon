import { describe, it, expect, vi } from 'vitest';
import { CartesiaSpeaker, findSpeaker, MacSpeaker } from '../../src/voice/speaker.js';

const pcmBytes = (...s: number[]) => { const b = new Uint8Array(s.length * 2); const v = new DataView(b.buffer); s.forEach((x, i) => v.setInt16(i * 2, x, true)); return b; };
const ok = (bytes: Uint8Array<ArrayBuffer>) => new Response(bytes, { status: 200 });

describe('CartesiaSpeaker', () => {
  it('asks Cartesia for raw 16-bit mono at the voice rate and returns the samples', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => ok(pcmBytes(1, -2, 300)));
    const sp = new CartesiaSpeaker({ apiKey: 'sk_test', voice: '11111111-2222-3333-4444-555555555555', model: 'sonic-3.6', fetch });
    expect(Array.from((await sp.speak('Onix is weak to Water.'))!)).toEqual([1, -2, 300]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.cartesia.ai/tts/bytes');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk_test', 'Cartesia-Version': '2026-08-14', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      model_id: 'sonic-3.6', transcript: 'Onix is weak to Water.', voice: { id: '11111111-2222-3333-4444-555555555555' }, language: 'en',
      output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 22050 },
    });
  });
  it('gives nothing when Cartesia refuses, and never prints the key', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sp = new CartesiaSpeaker({ apiKey: 'sk_secret', fetch: async () => new Response('bad key', { status: 401 }) });
    expect(await sp.speak('hi')).toBeNull();
    expect(err.mock.calls.flat().join(' ')).not.toContain('sk_secret');
    err.mockRestore();
  });
  it('gives up on a slow reply', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sp = new CartesiaSpeaker({ apiKey: 'k', timeoutMs: 20, fetch: (_u, init) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))) });
    expect(await sp.speak('hi')).toBeNull();
  });
  it('drops a half sample at the end', async () => {
    const sp = new CartesiaSpeaker({ apiKey: 'k', fetch: async () => ok(new Uint8Array([5, 0, 7])) });
    expect(Array.from((await sp.speak('hi'))!)).toEqual([5]);
  });
  it('uses a voice id from the settings, but only one shaped like an id', () => {
    expect(new CartesiaSpeaker({ apiKey: 'k', voice: '26403c37-80c1-4a1a-8692-540551ca2ae5' }).voice).toBe('26403c37-80c1-4a1a-8692-540551ca2ae5');
    expect(new CartesiaSpeaker({ apiKey: 'k', voice: '../x' }).voice).toBe(CartesiaSpeaker.DEFAULT_VOICE);
  });
});

describe('findSpeaker', () => {
  it('prefers Cartesia when a key is set', () => expect(findSpeaker({ CARTESIA_API_KEY: 'k' })).toBeInstanceOf(CartesiaSpeaker));
  it('falls back to the Mac voice without a key', () => {
    const sp = findSpeaker({});
    if (process.platform === 'darwin') expect(sp).toBeInstanceOf(MacSpeaker); else expect(sp).toBeNull();
  });
});
