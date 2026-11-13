import { describe, it, expect } from 'vitest';
import { pretty, statusWord, facingWord, BADGE_NAMES } from './words';

describe('words', () => {
  it('names statuses as words, fainted first', () => {
    expect(statusWord('OK', 10)).toBeNull();
    expect(statusWord('POISON', 10)).toBe('poisoned');
    expect(statusWord('SLEEP', 10)).toBe('asleep');
    expect(statusWord('PARALYZED', 10)).toBe('paralysed');
    expect(statusWord('BURN', 10)).toBe('burned');
    expect(statusWord('FREEZE', 10)).toBe('frozen');
    expect(statusWord('POISON', 0)).toBe('fainted');
    expect(statusWord('OK', 0)).toBe('fainted');
    expect(statusWord('SOMETHING NEW', 5)).toBe('something new');
  });
  it('turns facing into compass words', () => {
    expect(facingWord('up')).toBe('facing north');
    expect(facingWord('down')).toBe('facing south');
    expect(facingWord('left')).toBe('facing west');
    expect(facingWord('right')).toBe('facing east');
    expect(facingWord('?')).toBe('');
  });
  it('has the eight badge names in game order', () => {
    expect(BADGE_NAMES).toEqual(['Boulder', 'Cascade', 'Thunder', 'Rainbow', 'Soul', 'Marsh', 'Volcano', 'Earth']);
  });
  it('prettifies game names as before', () => {
    expect(pretty('REDS_HOUSE_2F')).toBe('Reds House 2F');
    expect(pretty('POKé BALL')).toBe('Poké Ball');
  });
});
