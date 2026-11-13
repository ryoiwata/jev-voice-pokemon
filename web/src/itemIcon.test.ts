import { describe, it, expect } from 'vitest';
import { itemIcon } from './itemIcon';

describe('itemIcon', () => {
  it.each([['POKé BALL', 'ball'], ['POKE BALL', 'ball'], ['ULTRA BALL', 'ball'], ['MASTER BALL', 'ball'], ['POTION', 'medicine'], ['SUPER POTION', 'medicine'],
    ['FULL RESTORE', 'medicine'], ['REVIVE', 'medicine'], ['MAX ETHER', 'medicine'], ['RARE CANDY', 'medicine'], ['ANTIDOTE', 'heal'], ['PARLYZ HEAL', 'heal'],
    ['FULL HEAL', 'heal'], ['AWAKENING', 'heal'], ['TM28', 'disc'], ['HM01', 'disc'], ['MOON STONE', 'stone'], ['FIRE STONE', 'stone'], ["OAK's PARCEL", 'key'],
    ['TOWN MAP', 'key'], ['BICYCLE', 'key'], ['POKéDEX', 'key'], ['S.S.TICKET', 'key'], ['OLD ROD', 'key'], ['NUGGET', 'box'], ['ESCAPE ROPE', 'box'], ['', 'box']])('%s → %s', (name, kind) => {
    expect(itemIcon(name)).toBe(kind);
  });
});
