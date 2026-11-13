import { describe, it, expect } from 'vitest';
import { parseClientMsg, buttonMask, maskButtons, voiceClip, readVoiceClip, TAG_VOICE } from '../../src/server/wire.js';

describe('parseClientMsg', () => {
  it('accepts a well-formed button message', () => {
    expect(parseClientMsg('{"type":"down","button":"A"}')).toEqual({ type: 'down', button: 'A' });
  });
  it('rejects unknown buttons, unknown types and non-JSON', () => {
    expect(parseClientMsg('{"type":"down","button":"TURBO"}')).toBeNull();
    expect(parseClientMsg('{"type":"explode"}')).toBeNull();
    expect(parseClientMsg('not json')).toBeNull();
    expect(parseClientMsg('null')).toBeNull();
  });
  it('rejects save names that could leave the saves folder', () => {
    expect(parseClientMsg('{"type":"save","name":"../x"}')).toBeNull();
    expect(parseClientMsg('{"type":"save","name":"before-brock"}')).toEqual({ type: 'save', name: 'before-brock' });
  });
  it('checks the shapes of text, choose, click and set', () => {
    expect(parseClientMsg('{"type":"text","text":"walk left"}')).toEqual({ type: 'text', text: 'walk left' });
    expect(parseClientMsg('{"type":"text","text":5}')).toBeNull();
    expect(parseClientMsg('{"type":"choose","logId":"a","index":1}')).toEqual({ type: 'choose', logId: 'a', index: 1 });
    expect(parseClientMsg('{"type":"click","col":3,"row":40}')).toBeNull();
    expect(parseClientMsg('{"type":"set","key":"mode","value":"text"}')).toEqual({ type: 'set', key: 'mode', value: 'text' });
    expect(parseClientMsg('{"type":"set","key":"mode","value":"agent"}')).toBeNull();
    expect(parseClientMsg('{"type":"set","key":"mode","value":"controls"}')).toBeNull();
    expect(parseClientMsg('{"type":"set","key":"mode","value":"turbo"}')).toBeNull();
  });
});

describe('button masks', () => {
  it('packs buttons into one byte and back', () => {
    expect(buttonMask([])).toBe(0);
    expect(buttonMask(['A'])).toBe(1);
    expect(buttonMask(['A', 'RIGHT'])).toBe(1 | 128);
    expect(buttonMask(['RIGHT', 'A', 'A'])).toBe(1 | 128);
    expect(maskButtons(1 | 128)).toEqual(['A', 'RIGHT']);
    expect(maskButtons(0)).toEqual([]);
  });
});

describe('voice clips', () => {
  it('round-trips a clip with its answer id', () => {
    const b = voiceClip(42, Int16Array.of(1, -1, 32767));
    expect(b[0]).toBe(TAG_VOICE);
    expect(readVoiceClip(b)).toEqual({ answerId: 42, pcm: Int16Array.of(1, -1, 32767) });
  });
});
