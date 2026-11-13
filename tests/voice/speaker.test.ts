import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { parseWav, MacSpeaker } from '../../src/voice/speaker.js';

/** A WAV file like the one `say` writes: RIFF/WAVE, an optional JUNK chunk, fmt, data. */
function makeWav(samples: number[], o: { junk?: number; channels?: number; rate?: number; bits?: number } = {}): Uint8Array {
  const parts: Buffer[] = [];
  const chunk = (id: string, body: Buffer) => { const h = Buffer.alloc(8); h.write(id, 0, 'ascii'); h.writeUInt32LE(body.length, 4); parts.push(h, body); };
  if (o.junk) chunk('JUNK', Buffer.alloc(o.junk));
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(o.channels ?? 1, 2); fmt.writeUInt32LE(o.rate ?? 22050, 4);
  fmt.writeUInt32LE((o.rate ?? 22050) * 2, 8); fmt.writeUInt16LE(2, 12); fmt.writeUInt16LE(o.bits ?? 16, 14);
  chunk('fmt ', fmt);
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(v, i * 2));
  chunk('data', data);
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(12); head.write('RIFF', 0, 'ascii'); head.writeUInt32LE(body.length + 4, 4); head.write('WAVE', 8, 'ascii');
  return new Uint8Array(Buffer.concat([head, body]));
}

const outOf = (args: string[]) => args[args.indexOf('-o') + 1];

describe('parseWav', () => {
  it('finds the samples after a JUNK chunk', () => expect(Array.from(parseWav(makeWav([1, -2, 3], { junk: 28 }))!)).toEqual([1, -2, 3]));
  it('rejects a WAV that is not mono 16-bit 22050 Hz', () => {
    expect(parseWav(makeWav([1], { channels: 2 }))).toBeNull();
    expect(parseWav(makeWav([1], { rate: 44100 }))).toBeNull();
  });
  it('rejects something that is not a WAV', () => expect(parseWav(new Uint8Array([1, 2, 3]))).toBeNull());
});

describe('MacSpeaker', () => {
  it('passes the text on stdin, never as arguments', async () => {
    const calls: { file: string; args: string[]; input: string }[] = [];
    const sp = new MacSpeaker({ run: async (file, args, input) => { calls.push({ file, args, input }); fs.writeFileSync(outOf(args), makeWav([5])); } });
    expect(Array.from((await sp.speak('-v Bad hi'))!)).toEqual([5]);
    expect(calls[0].file).toBe('say');
    expect(calls[0].args).toEqual(['-v', 'Fred', '-f', '-', '-o', expect.stringMatching(/\.wav$/), '--data-format=LEI16@22050']);
    expect(calls[0].input).toBe('-v Bad hi');
    expect(fs.existsSync(outOf(calls[0].args))).toBe(false);
  });
  it('deletes the temporary file, also when say fails', async () => {
    let out = '';
    const sp = new MacSpeaker({ run: async (_f, args) => { out = outOf(args); fs.writeFileSync(out, 'x'); throw new Error('boom'); } });
    expect(await sp.speak('hi')).toBeNull();
    expect(fs.existsSync(out)).toBe(false);
  });
  it('gives up on a slow sentence', async () => {
    const sp = new MacSpeaker({ timeoutMs: 20, run: () => new Promise(() => {}) });
    expect(await sp.speak('hi')).toBeNull();
  });
  it('ignores a voice name that is not plain words', () => {
    expect(new MacSpeaker({ voice: 'Fred; rm -rf' }).voice).toBe('Fred');
    expect(new MacSpeaker({ voice: 'Good News' }).voice).toBe('Good News');
  });
});
