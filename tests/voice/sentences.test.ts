import { describe, it, expect } from 'vitest';
import { speechText, SentenceCutter } from '../../src/voice/sentences.js';

describe('speechText', () => {
  it('reads levels as words', () => expect(speechText('Pikachu Lv12 and Onix Lv. 14')).toBe('Pikachu level 12 and Onix level 14'));
  it('drops game arrows, markdown and say commands', () => expect(speechText('**Use** [[volm 0]] Bubble▼')).toBe('Use volm 0 Bubble'));
  it('cannot be tricked into leaving a say command behind', () => {
    expect(speechText('Hi [*[slnc 3000]*] there')).not.toMatch(/\[\[|\]\]/);
    expect(speechText('Hi [[[slnc 3000]]] there')).not.toMatch(/\[\[|\]\]/);
  });
});

describe('SentenceCutter', () => {
  it('returns each sentence once, when it is complete', () => {
    const c = new SentenceCutter();
    expect(c.push('Onix is weak')).toEqual([]);
    expect(c.push('Onix is weak to Water. Use Bub')).toEqual(['Onix is weak to Water.']);
    expect(c.push('Onix is weak to Water. Use Bubble! It')).toEqual(['Use Bubble!']);
    expect(c.finish('Onix is weak to Water. Use Bubble! It works.')).toEqual({ sentences: ['It works.'], replaced: false });
  });
  it('does not cut on decimals or abbreviations', () => {
    const c = new SentenceCutter();
    expect(c.push('Mt. Moon is 1.5 times Lv. 3 Mr. Mime. Next')).toEqual(['Mt. Moon is 1.5 times level 3 Mr. Mime.']);
  });
  it('says the final text whole when it is not what streamed', () => {
    const c = new SentenceCutter();
    c.push('Here is how to. Then');
    expect(c.finish("I can't answer that one.")).toEqual({ sentences: ["I can't answer that one."], replaced: true });
  });
  it('does not read the start again when the stream began with a blank line', () => {
    const c = new SentenceCutter();
    expect(c.push('\nOnix is weak to Water. Use')).toEqual(['Onix is weak to Water.']);
    expect(c.finish('Onix is weak to Water. Use Bubble.')).toEqual({ sentences: ['Use Bubble.'], replaced: false });
  });
  it('speaks a fixed reply that never streamed', () => expect(new SentenceCutter().finish("Couldn't get an answer just now.")).toEqual({ sentences: ["Couldn't get an answer just now."], replaced: false }));
  it('skips empty pieces', () => expect(new SentenceCutter().finish('  ')).toEqual({ sentences: [], replaced: false }));
  it('cuts several sentences that arrive at once', () => expect(new SentenceCutter().push('One. Two? Three! Fo')).toEqual(['One.', 'Two?', 'Three!']));
});
