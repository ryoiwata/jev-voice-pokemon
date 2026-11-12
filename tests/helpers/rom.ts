import fs from 'node:fs';
import { Emulator } from '../../src/emu/emulator.js';
import { Rom } from '../../src/game/rom.js';
import { GameState } from '../../src/game/state.js';
import { newMemory, type Ctx } from '../../src/actions/types.js';

export const ROM_PATH = 'roms/red.gb';
export const hasRom = fs.existsSync(ROM_PATH) && fs.existsSync('src/data/generated.json');
const fixturePath = (name: string) => `saves/fixtures/${name}.state.json`;
export const hasFixture = (name: string) => hasRom && fs.existsSync(fixturePath(name));

/** A fresh emulator on the local ROM, optionally loaded from a save-state fixture. */
export function boot(fixture?: string): Ctx {
  const buf = fs.readFileSync(ROM_PATH);
  const emu = new Emulator(buf);
  const rom = new Rom(buf);
  const gs = new GameState(emu, rom);
  if (fixture) emu.loadState(fixturePath(fixture));
  return { emu, rom, gs, mem: newMemory(), log: () => {} };
}
