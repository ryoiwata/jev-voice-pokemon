import { describe, it, expect } from 'vitest';
import { nameWords } from '../../src/interpret/name.js';

describe('nameWords: the words in a sentence that could be the name', () => {
  it.each([
    ['Leo', ['Leo']],
    ["Let's go with Leo as the name", ['Leo']],
    ['my name is Ryo', ['Ryo']],
    ['I want to be called Red.', ['Red']],
    ['how about Sparky', ['Sparky']],
    ['type in ash please', ['ash']],
    ['call it Big Red', ['Big', 'Red']],
    ["let's go with the name", []],
    ['um', []],
    ['123', []],
  ])('%s → %j', (said, want) => { expect(nameWords(said)).toEqual(want); });
});

import { nameCandidates } from '../../src/interpret/name.js';
describe('nameCandidates: what Jev may pick the name from', () => {
  it('offers each word once, as said', () => {
    expect(nameCandidates("Let's name him Shigeru")).toEqual(['Lets', 'name', 'him', 'Shigeru']);
    expect(nameCandidates('Leo leo LEO')).toEqual(['Leo']);
  });
  it('also offers a name spelled out letter by letter', () => {
    expect(nameCandidates('call him L E O')).toContain('LEO');
  });
  it('also offers the words left after dropping filler, joined, when there are several', () => {
    expect(nameCandidates('my name is big joe')).toContain('bigjoe');
  });
  it('offers nothing for nothing', () => {
    expect(nameCandidates('  ')).toEqual([]);
  });
});
