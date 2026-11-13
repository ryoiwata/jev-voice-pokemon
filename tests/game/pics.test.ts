import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Rom } from '../../src/game/rom.js';
import { Pics } from '../../src/game/pics.js';
import { sym } from '../../src/game/symbols.js';
import { hasRom, ROM_PATH } from '../helpers/rom.js';

describe.skipIf(!hasRom)('pictures from the ROM', () => {
  const rom = hasRom ? new Rom(fs.readFileSync(ROM_PATH)) : (null as unknown as Rom);
  const pics = hasRom ? new Pics(rom) : (null as unknown as Pics);
  const id = (name: string) => [...rom.species.values()].find((s) => s.name === name)!.id;
  const sha1 = (p: Uint8Array) => crypto.createHash('sha1').update(p).digest('hex');

  it('finds each picture where the build says it is, across all the banks', () => {
    for (const [name, symbol] of [['RATTATA', 'RattataPicFront'], ['CHARMANDER', 'CharmanderPicFront'], ['MEW', 'MewPicFront'], ['RHYDON', 'RhydonPicFront'],
      ['PIKACHU', 'PikachuPicFront'], ['MEWTWO', 'MewtwoPicFront'], ['BULBASAUR', 'BulbasaurPicFront'], ['STARMIE', 'StarmiePicFront'], ['VICTREEBEL', 'VictreebelPicFront']] as const)
      expect(pics.frontAddress(id(name)), name).toBe(sym(symbol));
  });

  it('decodes all 151 species to pictures that are neither blank nor solid', () => {
    expect(rom.species.size).toBe(151);
    for (const s of rom.species.values()) {
      const p = pics.mon(s.id);
      expect(p.pixels.length, s.name).toBe(56 * 56);
      expect(new Set(p.pixels).size, s.name).toBeGreaterThanOrEqual(3);
      const lit = p.pixels.filter((v) => v !== 0).length / p.pixels.length;
      expect(lit, s.name).toBeGreaterThan(0.08);
      expect(lit, s.name).toBeLessThan(0.9);
    }
  });

  it('pictures stand on the floor: the bottom tile row is drawn on, the top-left corner is empty', () => {
    const p = pics.mon(id('RATTATA')).pixels;
    expect(p.slice(48 * 56).some((v) => v !== 0)).toBe(true);
    expect(p[0]).toBe(0);
  });

  it('decodes the trainer', () => {
    expect(new Set(pics.trainer().pixels).size).toBeGreaterThanOrEqual(3);
  });

  it('looks pictures up by the snapshot’s names, awkward ones included', () => {
    for (const n of ['MR.MIME', "FARFETCH'D", 'NIDORAN♂', 'NIDORAN♀']) expect(pics.monPng(n), n).not.toBeNull();
    expect(pics.monPng('../../etc/passwd')).toBeNull();
    expect(pics.monPng('MISSINGNO')).toBeNull();
    expect(pics.monPng('RATTATA')!.subarray(1, 4).toString()).toBe('PNG');
    expect(pics.monPng('RATTATA')).toBe(pics.monPng('RATTATA')); // cached: the same Buffer
    expect(pics.trainerPng().subarray(1, 4).toString()).toBe('PNG');
  });

  it('an unknown species id is an error, not a wild read', () => {
    expect(() => pics.mon(0)).toThrow();
    expect(() => pics.mon(999)).toThrow();
  });

  it('Rattata and Mew decode to the pictures checked by eye', () => {
    expect(sha1(pics.mon(id('RATTATA')).pixels)).toBe('3205d80ad402e353ef04ac925c13b1f5fc0d7602');
    expect(sha1(pics.mon(id('MEW')).pixels)).toBe('bbe837638bfdd0cd8163a30ac00be7f958d9725a');
  });
});
