import { describe, it, expect } from 'vitest';
import { snapshot } from '../../src/game/snapshot.js';
import { boot, hasRom, hasFixture } from '../helpers/rom.js';

describe.skipIf(!hasFixture('fx-battle'))('snapshot in a battle', () => {
  it('names the player, lists eight badges, and says which Pokémon is out', () => {
    const s = snapshot(boot('fx-battle'));
    expect(s.playerName.length).toBeGreaterThan(0);
    expect(s.badgeList).toEqual(Array(8).fill(false));
    expect(s.badges).toBe(0);
    expect(s.battle!.slot).toBe(0);
    expect(s.party[s.battle!.slot]).toBeDefined();
  });
});

describe.skipIf(!hasRom)('snapshot before the game starts', () => {
  it('has no name and eight unlit badges', () => {
    const s = snapshot(boot());
    expect(s.playerName).toBe('');
    expect(s.badgeList).toEqual(Array(8).fill(false));
  });
});

describe.skipIf(!hasFixture('fx-lab'))('snapshot: what is next to the player', () => {
  it('says what is on each side, in compass words', () => {
    const s = snapshot(boot('fx-lab'));   // rival to the west, Oak to the north, a Poké Ball on the table to the east, floor to the south
    expect(s.around).toEqual({ north: 'someone or something is standing there', south: 'open ground', west: 'someone or something is standing there', east: 'someone or something is standing there' });
  });
  it('is absent when the player is not walking around', () => {
    expect(snapshot(boot()).around).toBeUndefined();
  });
});
