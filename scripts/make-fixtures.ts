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
  throw new Error(`make-fixtures: gave up waiting for ${what} (${detectMode(ctx)} @ ${gs.mapName} ${gs.x},${gs.y})\n${gs.screen().rows.join('\n')}`);
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

// ---- stage B: from here on only the app's own action list is used (this is also an end-to-end check of it)
import { listActions, runAction } from '../src/actions/index.js';

const labels = () => listActions(ctx).map((a) => a.label);
function act(re: RegExp) {
  const a = listActions(ctx).find((x) => re.test(x.label) && x.kind !== 'press' && x.kind !== 'steps');
  if (!a) throw new Error(`make-fixtures: no action matching ${re} among: ${labels().join(' | ')}`);
  const r = runAction(ctx, a.id);
  console.log(`  ${a.label} → ${r.status}: ${r.message}`);
  return r;
}
/** Get through whatever is on screen until `done`: continue text, answer menus with `answer`, wait out cutscenes. */
function through(what: string, done: () => boolean, answer: (opts: string[]) => RegExp | null = () => null, cap = 20000) {
  until(what, done, () => {
    const acts = listActions(ctx);
    const menu = acts.filter((a) => a.kind === 'menu').map((a) => a.label);
    const pick = menu.length ? answer(menu) : null;
    if (pick) act(pick);
    else if (acts.some((a) => a.id === 'text:next')) runAction(ctx, 'text:next');
    else emu.wait(10);
  }, cap);
}
/** free to walk, and still free a second later (scripted scenes hand control back for a moment between steps) */
const free = () => { if (detectMode(ctx) !== 'overworld') return false; emu.wait(60); return detectMode(ctx) === 'overworld'; };

act(/^Enter Reds House 1F/);
act(/^Enter Pallet Town/);
act(/^Go north to Route 1/);                                   // Oak stops the player and leads the way
through("Oak's lab", () => gs.mapName === 'OAKS_LAB' && free());
emu.wait(30);
save('fx-lab');

act(/^Examine the Poké Ball/);
through('the starter', () => gs.party().length === 1 && free(), (o) => (o.includes('YES') && /nickname/i.test(gs.screen().rows.join(' ')) ? /^NO$/ : o.includes('YES') ? /^YES$/ : null));
act(/^Enter Pallet Town/);                                     // the rival challenges on the way out
through('the rival battle menu', () => gs.inBattle === 2 && !!gs.screen().cursor && !!findLabel(ctx, 'FIGHT'), () => null, 6000);
emu.wait(20);
save('fx-battle');
