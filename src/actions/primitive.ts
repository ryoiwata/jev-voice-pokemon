import type { Button } from '../emu/emulator.js';
import type { Action, ActionResult, Ctx } from './types.js';
import { detectMode } from '../game/mode.js';
import { sym } from '../game/symbols.js';
import { tap } from './nav.js';
import { buildGrid, findPath, DIRS as DELTA } from '../game/world.js';

const BUTTONS: Button[] = ['A', 'B', 'START', 'SELECT', 'UP', 'DOWN', 'LEFT', 'RIGHT'];
const DIRS = ['up', 'down', 'left', 'right'] as const;
type Dir = (typeof DIRS)[number];
export const MAX_STEPS = 20;

/** Always available: single buttons, a pause, and (when free to walk) a few steps in a direction. */
export function listPrimitive(ctx: Ctx): Action[] {
  const out: Action[] = BUTTONS.map((b) => ({ id: `press:${b}`, kind: 'press', label: `Press ${b}` }));
  out.push({ id: 'wait', kind: 'press', label: 'Wait a moment' });
  if (detectMode(ctx) === 'overworld') {
    for (const d of DIRS) out.push({ id: `steps:${d}`, kind: 'steps', label: `Step ${d}`, hint: `Take plain steps ${d}: only when the player gives just this direction ("go ${d}", "move ${d} a bit", "keep going ${d}" for as far as it goes) and names no thing or place to go to` });
    out.push({ id: 'steps:forward', kind: 'steps', label: 'Step forward', hint: 'Take plain steps forward, the way the player is already facing: "forward", "go straight", "keep going", "continue" with no direction and no thing or place named' });
  }
  return out;
}

/**
 * The way ahead is blocked. If a square a little further along the same line can be reached by a short
 * walk round the obstacle, go there. A person in the way is always walked round; a thing (a sign, a
 * stump) only when it is one square thick and the player asked to keep going. Doors are never stepped
 * on. Returns how many squares further along the line the player now is, or 0 if there was no way round.
 */
function goAround(ctx: Ctx, dir: Dir, left: number, keepGoing: boolean): number {
  const { gs, rom, emu } = ctx;
  const [dx, dy] = DELTA[dir];
  const px = gs.x, py = gs.y;
  const people = new Set(gs.sprites().filter((sp) => !sp.hidden).map((sp) => `${sp.x},${sp.y}`));
  const person = people.has(`${px + dx},${py + dy}`);
  if (!person && !keepGoing) return 0;
  const g = buildGrid(emu, rom, gs);
  const blocked = new Set([...people, ...(rom.maps.get(gs.mapId)?.warps ?? []).map((w) => `${w.x},${w.y}`)]);
  for (let k = 2; k <= Math.min(person ? 4 : 2, left); k++) {
    const tx = px + k * dx, ty = py + k * dy;
    if (!g.walkable(tx, ty) || blocked.has(`${tx},${ty}`)) continue;
    const path = findPath(g, px, py, (x, y) => x === tx && y === ty, { blocked, maxNodes: 800 });
    if (!path || path.length > k + 6 || path.some((st) => st.jump || st.spin)) continue;
    for (const st of path) if (!stepOnce(ctx, st.dir)) return 0;
    return gs.x === tx && gs.y === ty ? k : 0;
  }
  return 0;
}

/** What stopped a walk, in words, when it wasn't simply a wall. */
export function interruption(ctx: Ctx): string | null {
  const { gs } = ctx;
  if (gs.inBattle === 1) return 'A wild Pokémon appeared.';
  if (gs.inBattle) return 'A battle started.';
  if (gs.screen().hasTextBox) return 'Something came up on screen.';
  return null;
}

/** Hold a direction until the player has moved one tile. False if nothing moved. */
export function stepOnce(ctx: Ctx, dir: Dir): boolean {
  const { gs, emu } = ctx;
  const x0 = gs.x, y0 = gs.y, map0 = gs.mapId;
  const btn = dir.toUpperCase() as Button;
  let moved = false;
  // the first press may only turn the player; with many sprites on screen one step can take well over 40 frames
  for (let f = 0; f < 90; f++) {
    emu.frame([btn]);
    if (gs.x !== x0 || gs.y !== y0 || gs.mapId !== map0) { moved = true; break; }
    if (gs.inBattle || gs.screen().hasTextBox) break;
  }
  for (let f = 0; f < 60 && emu.mem[sym('wWalkCounter')] !== 0; f++) emu.frame(); // let the step finish
  emu.wait(2);
  return moved;
}

export function runPrimitive(ctx: Ctx, a: Action, arg?: unknown): ActionResult {
  if (a.id === 'wait') { ctx.emu.wait(60); return { status: 'done', message: 'Waited.' }; }
  if (a.kind === 'press') {
    const b = a.id.slice('press:'.length) as Button;
    tap(ctx, b, 10);
    return { status: 'done', message: `Pressed ${b}.` };
  }
  const asked = a.id.slice('steps:'.length);
  const facing = ctx.gs.facing;
  if (asked === 'forward' && !(DIRS as readonly string[]).includes(facing)) return { status: 'failed', message: "Can't tell which way is forward right now." };
  const dir = (asked === 'forward' ? facing : asked) as Dir;
  const want = Math.max(1, Math.min(MAX_STEPS, Math.floor(Number(arg ?? 1)) || 1));
  const map0 = ctx.gs.mapId;
  let taken = 0, around = false;
  while (taken < want) {
    if (stepOnce(ctx, dir)) { taken++; }
    else {
      // something is in the way: with more steps still to go, walk round it and carry on in the same line
      const k = interruption(ctx) || want - taken < 2 ? 0 : goAround(ctx, dir, want - taken, want === MAX_STEPS);
      if (k <= 0) break;
      taken += k; around = true;
    }
    if (ctx.gs.mapId !== map0) return { status: 'done', message: `Walked ${dir} into a new area.` };
  }
  const steps = (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`;
  if (taken === want) return { status: 'done', message: `Walked ${steps(taken)} ${dir}${around ? ', going around someone in the way' : ''}.` };
  const came = interruption(ctx);
  // the most steps there are means "until something is in the way", so reaching a wall is the walk finishing, not failing
  if (want === MAX_STEPS && taken > 0 && !came) return { status: 'done', message: `Walked ${steps(taken)} ${dir}, as far as it goes.` };
  const why = came ?? 'Something is in the way.';
  return { status: 'interrupted', message: taken ? `Walked ${steps(taken)} ${dir}, then stopped. ${why}` : why };
}
