import { describe, it, expect } from 'vitest';
import { parseClientMsg } from '../../src/server/wire.js';

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
    expect(parseClientMsg('{"type":"set","key":"mode","value":"agent"}')).toEqual({ type: 'set', key: 'mode', value: 'agent' });
    expect(parseClientMsg('{"type":"set","key":"mode","value":"turbo"}')).toBeNull();
  });
});
