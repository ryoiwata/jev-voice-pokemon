// Builds the save-state fixtures the tests use, by playing from power-on on YOUR ROM.
// Fixtures land in saves/fixtures/ (gitignored). Run: npx tsx scripts/make-fixtures.ts
import fs from 'node:fs';
import { Emulator } from '../src/emu/emulator.js';
import { Rom } from '../src/game/rom.js';
import { GameState } from '../src/game/state.js';
import { newMemory, type Ctx } from '../src/actions/types.js';
import { detectMode } from '../src/game/mode.js';
import { findLabel, tap } from '../src/actions/nav.js';

const DIR = 'saves/fixtures';
fs.mkdirSync(DIR, { recursive: true });
const buf = fs.readFileSync('roms/red.gb');
const emu = new Emulator(buf);
const rom = new Rom(buf);
const ctx: Ctx = { emu, rom, gs: new GameState(emu, rom), mem: newMemory(), log: () => {} };
const { gs } = ctx;

function save(name: string) { emu.saveState(`${DIR}/${name}.state.json`); console.log(`saved ${name}  (${detectMode(ctx)} @ ${gs.mapName})`); }
/** Repeat `step` until `done`, or throw when the cap is hit. */
function until(what: string, done: () => boolean, step: () => void, cap = 4000) {
  for (let i = 0; i < cap; i++) { if (done()) return; step(); }
  throw new Error(`make-fixtures: gave up waiting for ${what}`);
}
/** Press A through plain text; otherwise just let frames pass. */
function talk() { if (gs.screen().waitingForA) tap(ctx, 'A', 8); else emu.wait(4); }

// A: first dialogue box of the intro
until('the first text box', () => gs.screen().hasTextBox && gs.screen().waitingForA, () => {
  if (findLabel(ctx, 'NEW GAME')) tap(ctx, 'A', 30); else if (gs.screen().hasTextBox) emu.wait(4); else emu.press('START', 6, 40);
});
save('fx-dialog');

// A: the player-name menu
until('the name menu', () => !!gs.screen().cursor && !!findLabel(ctx, 'NEW NAME'), talk);
emu.wait(20);
save('fx-menu');

// A: free to walk in the bedroom (first preset name for player and rival)
until('the bedroom', () => detectMode(ctx) === 'overworld' && gs.mapName === 'REDS_HOUSE_2F', () => {
  if (gs.screen().cursor && findLabel(ctx, 'NEW NAME')) { tap(ctx, 'DOWN', 10); tap(ctx, 'A', 30); } else talk();
}, 20000);
emu.wait(30);
save('fx-bedroom');
