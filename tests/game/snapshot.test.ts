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
