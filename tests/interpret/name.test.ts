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
