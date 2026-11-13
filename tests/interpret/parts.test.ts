import { describe, it, expect } from 'vitest';
import { splitParts } from '../../src/interpret/parts.js';

describe('splitParts: one sentence, several commands', () => {
  it.each([
    ['Get around the boy and continue east.', ['Get around the boy', 'continue east']],
    ['go around the boy and then talk to the girl', ['go around the boy', 'talk to the girl']],
    ['leave the grass, then read the sign', ['leave the grass', 'read the sign']],
    ['walk to the door then go inside then talk to the nurse', ['walk to the door', 'go inside', 'talk to the nurse']],
    ['go north. Talk to the man.', ['go north', 'Talk to the man']],
    ['open the menu and save the game', ['open the menu', 'save the game']],
  ])('%s', (said, parts) => { expect(splitParts(said)).toEqual(parts); });

  it.each([
    'talk to mom',
    'use potion on pikachu',
    'talk to the man and the woman',          // "and" joining two things, not two commands
    'what is Onix weak to and why?',
    'name him Salt and Pepper',
    'go up and down',                         // no second verb: one (odd) command, left for the model
    '',
  ])('leaves "%s" whole', (said) => { expect(splitParts(said)).toEqual(said.trim() ? [said.trim().replace(/[.!?]+$/, '')] : []); });

  it('never makes more than four parts; the rest stays with the last', () => {
    expect(splitParts('go up then go down then go left then go right then go up then go down')).toHaveLength(4);
  });
});
