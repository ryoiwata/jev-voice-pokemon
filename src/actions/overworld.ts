// What the player can do while free to walk, and how each thing is carried out.
// The walking and interaction mechanics come from the reference (src/agent/overworld.ts);
// everything that chose for the player (objectives, route hints, exploring, grinding) is gone.
import gen from '../data/generated.json' with { type: 'json' };
import type { Button } from '../emu/emulator.js';
import { buildGrid, findPath, DIRS, type Dir, type Grid, type Step } from '../game/world.js';
import { HOLES } from '../game/regions.js';
import { LANDMARKS } from '../game/landmarks.js';
import { sym, mapName } from '../game/symbols.js';
import { detectMode } from '../game/mode.js';
import type { Action, ActionResult, Ctx } from './types.js';
import { closeMenus, openStart, slotWithMove, tap, useFieldMove, useItem } from './nav.js';
import { interruption } from './primitive.js';

const SPRITES = (gen as any).sprites as Record<string, string>;

type Target =
  | { kind: 'warp'; x: number; y: number; dest: number }
  | { kind: 'exit'; dir: Dir; dest: number }
  | { kind: 'npc'; index: number; x: number; y: number; talk: boolean }
  | { kind: 'sign'; x: number; y: number }
  | { kind: 'hidden'; x: number; y: number }
  | { kind: 'cut'; x: number; y: number }
  | { kind: 'surf'; x: number; y: number }
  | { kind: 'strength' }
  | { kind: 'start' }
  | { kind: 'item'; name: string }
  | { kind: 'tile'; x: number; y: number; face?: { x: number; y: number } };

interface Candidate { action: Action; target: Target; path: Step[] }

/** "REDS_HOUSE_1F" → "Reds House 1F" */
export const pretty = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(B?\d+)f\b/gi, (_, n) => `${n.toUpperCase()}F`);

const adj = (x: number, y: number, tx: number, ty: number) => Math.abs(x - tx) + Math.abs(y - ty) === 1;

/** Squares from which the player can interact with (tx,ty): adjacent, or across a counter. */
function interactGoal(g: Grid, tx: number, ty: number) {
  return (x: number, y: number) => {
    if (adj(x, y, tx, ty)) return true;
    for (const [dx, dy] of Object.values(DIRS)) if (x + 2 * dx === tx && y + 2 * dy === ty && g.counter(x + dx, y + dy)) return true;
    return false;
  };
}

const OBJECTS: Record<string, string> = {
  POKE_BALL: 'Poké Ball', FOSSIL: 'fossil', BOULDER: 'boulder', POKEDEX: 'Pokédex', CLIPBOARD: 'clipboard', PAPER: 'paper', OLD_AMBER: 'amber stone', SNORLAX: 'sleeping Snorlax',
};
const HIDDEN_LABEL: [RegExp, string][] = [
  [/PokemonCenterPC|RedsPC|BillsHousePC/, 'Use the PC'], [/Switches/, 'Press the switch'], [/GymTrash/, 'Search the trash can'],
  [/GymStatues/, 'Read the gym statue'], [/CinnabarQuiz/, 'Use the quiz machine'], [/Fossil/, 'Examine the fossil'], [/Binoculars/, 'Look through the binoculars'],
];
/** these only respond when the player faces up at them */
const UP_ONLY = /Quiz|GymStatues|Binoculars|PokemonCenterPC|BillsHousePC|OakLabEmail|IndigoPlateauHQ/;

function compass(px: number, py: number, x: number, y: number): string {
  const dx = x - px, dy = y - py;
  if (!dx && !dy) return 'right here';
  const ns = Math.abs(dy) * 2 >= Math.abs(dx) ? (dy < 0 ? 'north' : 'south') : '';
  const ew = Math.abs(dx) * 2 >= Math.abs(dy) ? (dx < 0 ? 'west' : 'east') : '';
  return `to the ${ns && ew ? `${ns}-${ew}` : ns || ew}`;
}

/** Labels must be different from each other so a spoken command can name exactly one thing. */
function makeUnique(cands: Candidate[], px: number, py: number) {
  const groups = (key: (c: Candidate) => string) => {
    const m = new Map<string, Candidate[]>();
    for (const c of cands) m.set(key(c), [...(m.get(key(c)) ?? []), c]);
    return [...m.values()].filter((g) => g.length > 1);
  };
  for (const g of groups((c) => c.action.label)) for (const c of g) if (c.action.at) c.action.label += ` ${compass(px, py, c.action.at.x, c.action.at.y)}`;
  const ORD = ['nearest', 'second nearest', 'third nearest', 'fourth nearest', 'fifth nearest', 'sixth nearest'];
  for (const g of groups((c) => c.action.label)) {
    g.sort((a, b) => a.path.length - b.path.length);
    g.forEach((c, i) => { c.action.label += ` (${ORD[i] ?? `number ${i + 1}`})`; });
  }
}

/**
 * How to get next to a tile that cannot be stood on (a bed, a table, a wall), to face it. In front (below)
 * comes first, since that is where one looks at furniture from; then the sides, then behind.
 */
function approach(g: Grid, px: number, py: number, x: number, y: number, blocked: Set<string>, surf: boolean): Step[] | null {
  for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
    const sx = x + dx, sy = y + dy;
    if (!g.walkable(sx, sy) || blocked.has(`${sx},${sy}`)) continue;
    const path = sx === px && sy === py ? [] : findPath(g, px, py, (cx, cy) => cx === sx && cy === sy, { blocked, surf, maxNodes: 8000 });
    if (path) return path;
  }
  return null;
}

function candidates(ctx: Ctx): Candidate[] {
  const { gs, rom } = ctx;
  const g = buildGrid(ctx.emu, rom, gs);
  const md = rom.maps.get(gs.mapId);
  const px = gs.x, py = gs.y;
  const surf = gs.walkState === 2;
  const holes = HOLES.filter((h) => h.from === gs.mapName);
  // people block, and so do doors and holes: stepping on one mid-path would take the player away by accident
  const warpSquares = new Set([...(md?.warps ?? []).map((w) => `${w.x},${w.y}`), ...holes.map((h) => `${h.x},${h.y}`)]);
  const sprites = gs.sprites().filter((sp) => !sp.hidden);
  const occupied = new Set(sprites.map((sp) => `${sp.x},${sp.y}`));
  const blocked = new Set([...occupied, ...warpSquares, ...(ctx.mem.trapSquares[gs.mapName] ?? [])]);
  const except = (k: string) => { const b = new Set(blocked); b.delete(k); return b; };

  const out: Candidate[] = [];
  const add = (action: Omit<Action, 'distance'>, target: Target, path: Step[] | null) => {
    if (path) out.push({ action: { ...action, distance: path.length }, target, path });
  };

  // doors, stairs, ladders (two tiles of one doorway count once: the nearer)
  const doors: Candidate[] = [];
  const lastMap = gs.u8('wLastMap');
  for (const w of md?.warps ?? []) {
    if (occupied.has(`${w.x},${w.y}`)) continue;
    const dest = w.destMap !== 0xff ? w.destMap : lastMap;
    const path = px === w.x && py === w.y ? [] : findPath(g, px, py, (x, y) => x === w.x && y === w.y, { blocked: except(`${w.x},${w.y}`), surf });
    if (!path) continue;
    const twin = doors.find((d) => d.target.kind === 'warp' && d.target.dest === dest && adj(d.target.x, d.target.y, w.x, w.y));
    if (twin && twin.path.length <= path.length) continue;
    if (twin) doors.splice(doors.indexOf(twin), 1);
    doors.push({ action: { id: `warp:${w.x},${w.y}@${gs.mapId}`, kind: 'door', label: `Enter ${pretty(mapName(dest))}`, hint: `Enter ${pretty(mapName(dest))}: go through the door, stairs or ladder that leads there (this is how to leave, go outside, go upstairs or downstairs toward it)`, at: { x: w.x, y: w.y }, distance: path.length }, target: { kind: 'warp', x: w.x, y: w.y, dest }, path });
  }
  out.push(...doors);
  for (const h of holes) {
    const path = px === h.x && py === h.y ? [] : findPath(g, px, py, (x, y) => x === h.x && y === h.y, { blocked: except(`${h.x},${h.y}`), surf });
    const to = [...rom.maps.values()].find((m) => m.name === h.to);
    add({ id: `warp:${h.x},${h.y}@${gs.mapId}`, kind: 'door', label: `Drop through the hole to ${pretty(h.to)}`, at: { x: h.x, y: h.y } }, { kind: 'warp', x: h.x, y: h.y, dest: to?.id ?? -1 }, path);
  }

  // walking off the edge of the map into the next area
  for (const c of md?.connections ?? []) {
    const dir: Dir = c.dir === 'north' ? 'up' : c.dir === 'south' ? 'down' : c.dir === 'west' ? 'left' : 'right';
    const exitGoal = (x: number, y: number) => (dir === 'up' && y === -1) || (dir === 'down' && y === g.h) || (dir === 'left' && x === -1) || (dir === 'right' && x === g.w);
    const path = findPath(g, px, py, exitGoal, { blocked, allowExit: exitGoal, surf });
    add({ id: `exit:${dir}`, kind: 'go', label: `Go ${c.dir} to ${pretty(mapName(c.map))}`, hint: `Go ${c.dir} to ${pretty(mapName(c.map))}: walk off the ${c.dir} edge of this area into the next one` }, { kind: 'exit', dir, dest: c.map }, path);
  }

  // people and things standing on the map
  for (const sp of sprites) {
    const name = SPRITES[sp.picture] ?? `SPRITE_${sp.picture}`;
    const obj = md?.objects[sp.index - 1];
    const ig = interactGoal(g, sp.x, sp.y);
    const path = ig(px, py) ? [] : findPath(g, px, py, ig, { blocked, maxNodes: 6000 });
    const boulder = name === 'BOULDER';
    const label = obj?.item != null ? 'Pick up the item ball'
      : boulder ? 'Go to the boulder'
      : OBJECTS[name] ? `Examine the ${OBJECTS[name]}`
      : `Talk to ${pretty(obj?.trainerClass ?? name)}`;
    add({ id: `npc:${sp.index}@${gs.mapId}`, kind: 'interact', label, at: { x: sp.x, y: sp.y } }, { kind: 'npc', index: sp.index, x: sp.x, y: sp.y, talk: !boulder }, path);
  }

  for (const sg of md?.signs ?? []) {
    const ig = interactGoal(g, sg.x, sg.y);
    const path = ig(px, py) ? [] : findPath(g, px, py, ig, { blocked, maxNodes: 6000 });
    add({ id: `sign:${sg.x},${sg.y}@${gs.mapId}`, kind: 'interact', label: 'Read the sign', at: { x: sg.x, y: sg.y } }, { kind: 'sign', x: sg.x, y: sg.y }, path);
  }

  // PCs, switches, statues and the like. Hidden items are left out: a player can't see them either.
  for (const h of rom.hidden.get(gs.mapId) ?? []) {
    if (/HiddenItems|HiddenCoins|StartSlotMachine|CableClub/.test(h.fn)) continue;
    const face = UP_ONLY.test(h.fn) ? 4 : [0, 4, 8, 0xc].includes(h.arg) && /PC|Switches/.test(h.fn) ? h.arg : null;
    const standOk = (x: number, y: number) => {
      if (face === null) return adj(x, y, h.x, h.y);
      const [dx, dy] = face === 4 ? [0, 1] : face === 0 ? [0, -1] : face === 8 ? [1, 0] : [-1, 0];
      return x === h.x + dx && y === h.y + dy;
    };
    const path = standOk(px, py) ? [] : findPath(g, px, py, standOk, { blocked, maxNodes: 6000 });
    const label = HIDDEN_LABEL.find(([re]) => re.test(h.fn))?.[1]
      ?? `Examine the ${h.fn.replace(/^(Print|Display|Open)/, '').replace(/Text$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}`;
    add({ id: `hidden:${h.x},${h.y}@${gs.mapId}`, kind: 'interact', label, at: { x: h.x, y: h.y } }, { kind: 'hidden', x: h.x, y: h.y }, path);
  }

  // Furniture and scenery (a bed, a table, a bookshelf). The game does not treat these as things, so they
  // come from a table of tile ids. Touching tiles of the same kind are one piece of furniture.
  const names = LANDMARKS[g.tileset];
  if (names) {
    const taken = new Set(out.map((c) => (c.action.at ? `${c.action.at.x},${c.action.at.y}` : '')));
    const seen = new Set<string>();
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const name = names[g.tile(x, y)];
      if (!name || seen.has(`${x},${y}`) || g.walkable(x, y)) continue;
      const piece: { x: number; y: number }[] = [];
      const stack = [{ x, y }];
      while (stack.length) {
        const t = stack.pop()!;
        if (t.x < 0 || t.y < 0 || t.x >= g.w || t.y >= g.h || seen.has(`${t.x},${t.y}`) || names[g.tile(t.x, t.y)] !== name) continue;
        seen.add(`${t.x},${t.y}`); piece.push(t);
        stack.push({ x: t.x + 1, y: t.y }, { x: t.x - 1, y: t.y }, { x: t.x, y: t.y + 1 }, { x: t.x, y: t.y - 1 });
      }
      if (piece.some((t) => taken.has(`${t.x},${t.y}`))) continue; // already a thing in its own right (a TV that is a sign)
      // stand at whichever of its tiles is quickest to reach, lowest first
      piece.sort((a, b) => b.y - a.y);
      let best: { t: { x: number; y: number }; path: Step[] } | null = null;
      for (const t of piece) { const path = approach(g, px, py, t.x, t.y, blocked, surf); if (path && (!best || path.length < best.path.length)) best = { t, path }; }
      if (best) add({ id: `scenery:${best.t.x},${best.t.y}@${gs.mapId}`, kind: 'go', label: `Go to the ${name}`, hint: `Go to the ${name}: walk up to it and stand in front of it`, at: best.t }, { kind: 'tile', x: best.t.x, y: best.t.y, face: best.t }, best.path);
    }
  }

  // field moves the party actually knows
  if (slotWithMove(ctx, 'CUT') >= 0) {
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      if (!g.cuttable(x, y)) continue;
      const goal = (sx: number, sy: number) => adj(sx, sy, x, y);
      const path = goal(px, py) ? [] : findPath(g, px, py, goal, { blocked, maxNodes: 4000 });
      add({ id: `cut:${x},${y}@${gs.mapId}`, kind: 'field', label: 'Cut the tree', at: { x, y } }, { kind: 'cut', x, y }, path);
    }
  }
  if (slotWithMove(ctx, 'SURF') >= 0 && !surf) {
    let best: { x: number; y: number; path: Step[] } | null = null;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      if (!g.water(x, y) || (best && Math.abs(x - px) + Math.abs(y - py) - 1 >= best.path.length)) continue;
      const goal = (sx: number, sy: number) => adj(sx, sy, x, y) && g.walkable(sx, sy);
      const path = goal(px, py) ? [] : findPath(g, px, py, goal, { blocked, maxNodes: 3000 });
      if (path && (!best || path.length < best.path.length)) best = { x, y, path };
    }
    if (best) add({ id: `surf:${best.x},${best.y}@${gs.mapId}`, kind: 'field', label: 'Surf on the water', at: { x: best.x, y: best.y } }, { kind: 'surf', x: best.x, y: best.y }, best.path);
  }
  if (slotWithMove(ctx, 'STRENGTH') >= 0 && sprites.some((sp) => SPRITES[sp.picture] === 'BOULDER') && !(gs.u8('wStatusFlags1') & 1)) {
    out.push({ action: { id: 'strength', kind: 'field', label: 'Use Strength' }, target: { kind: 'strength' }, path: [] });
  }

  makeUnique(out, px, py);
  out.sort((a, b) => a.path.length - b.path.length);

  out.push({ action: { id: 'start', kind: 'interact', label: 'Open the menu' }, target: { kind: 'start' }, path: [] });
  for (const it of gs.bag()) out.push({ action: { id: `item:${it.name}`, kind: 'item', label: `Use ${it.name}` }, target: { kind: 'item', name: it.name }, path: [] });
  return out;
}

export function listOverworld(ctx: Ctx): Action[] {
  return candidates(ctx).map((c) => c.action);
}

/** A walk to one exact map tile (from a click on the game screen). Not listed; null if there is no way there. */
function tileCandidate(ctx: Ctx, x: number, y: number): Candidate | null {
  const { gs, rom } = ctx;
  if (x === gs.x && y === gs.y) return { action: { id: `tile:${x},${y}`, kind: 'tile', label: 'Walk there' }, target: { kind: 'tile', x, y }, path: [] };
  const g = buildGrid(ctx.emu, rom, gs);
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return null;
  const md = rom.maps.get(gs.mapId);
  const blocked = new Set([...gs.sprites().filter((sp) => !sp.hidden).map((sp) => `${sp.x},${sp.y}`), ...(md?.warps ?? []).map((w) => `${w.x},${w.y}`)]);
  blocked.delete(`${x},${y}`);
  const surf = gs.walkState === 2;
  const path = g.walkable(x, y) ? findPath(g, gs.x, gs.y, (cx, cy) => cx === x && cy === y, { blocked, surf, maxNodes: 8000 }) : null;
  if (path) return { action: { id: `tile:${x},${y}`, kind: 'tile', label: 'Walk there', distance: path.length }, target: { kind: 'tile', x, y }, path };
  // Not somewhere one can stand (a bed, a table, a wall): walk up to it instead and face it.
  const near = approach(g, gs.x, gs.y, x, y, blocked, surf);
  if (near) return { action: { id: `tile:${x},${y}`, kind: 'tile', label: 'Walk up to it', distance: near.length }, target: { kind: 'tile', x, y, face: { x, y } }, path: near };
  return null;
}

/** Which action a click on screen tile (col 0-9, row 0-8) means. The player is always drawn at col 4, row 4. */
export function tileAction(ctx: Ctx, col: number, row: number): string | null {
  if (detectMode(ctx) !== 'overworld') return null;
  const x = ctx.gs.x + col - 4, y = ctx.gs.y + row - 4;
  const hit = candidates(ctx).find((c) => c.action.at && c.action.at.x === x && c.action.at.y === y);
  return hit ? hit.action.id : `tile:${x},${y}`;
}

// ---- carrying it out

type WalkResult = 'ok' | 'blocked' | 'interrupted' | 'warped' | 'moved';

function waitWalkDone(ctx: Ctx) {
  for (let i = 0; i < 30 && ctx.emu.mem[sym('wWalkCounter')] !== 0; i++) ctx.emu.frame();
}

/** Wait until the game hands control back (the flags drop briefly between arrow tiles). False if a battle/text started. */
function waitControl(ctx: Ctx): boolean {
  const { gs, emu } = ctx;
  for (let f = 0, calm = 0; f < 1200 && calm < 16; f++) {
    emu.frame();
    if (gs.inBattle || gs.screen().hasTextBox) return false;
    calm = (gs.joyIgnore & 0xf0) || (gs.u8('wStatusFlags5') & 0x80) || emu.mem[sym('wWalkCounter')] !== 0 ? 0 : calm + 1;
  }
  return true;
}

function settleAfterMapChange(ctx: Ctx) {
  const { gs, emu } = ctx;
  emu.wait(45); // let the warp fade finish before trusting anything (a fade can look 'stable')
  let last = '', stable = 0;
  for (let f = 0; f < 400 && stable < 30; f++) {
    const snap = `${gs.mapId}|${gs.x},${gs.y}|${gs.joyIgnore}|${gs.sprites().map((s) => `${s.x},${s.y},${s.hidden}`).join(';')}`;
    stable = snap === last && gs.joyIgnore === 0 ? stable + 1 : 0;
    last = snap;
    emu.frame();
  }
}

/** Execute path steps. Stops on map change, text box, battle, or blockage. */
function walk(ctx: Ctx, path: Step[]): WalkResult {
  const { gs, emu } = ctx;
  const map0 = gs.mapId;
  for (const st of path) {
    const x0 = gs.x, y0 = gs.y;
    const btn = st.dir.toUpperCase() as Button;
    let moved = false;
    // the first press may only turn the player; with many sprites on screen one step can take well over 40 frames
    for (let f = 0; f < 90; f++) {
      emu.frame([btn]);
      if (gs.x !== x0 || gs.y !== y0 || gs.mapId !== map0) { moved = true; break; }
      if (gs.inBattle || gs.screen().hasTextBox) break;
    }
    waitWalkDone(ctx);
    if (st.jump) emu.wait(20);
    if (st.spin) {
      // arrow tile: the game moves the player; wait it out, then make sure we landed as predicted
      if (!waitControl(ctx)) return 'interrupted';
      if (gs.mapId !== map0) { settleAfterMapChange(ctx); return 'warped'; }
      if (gs.x !== st.x || gs.y !== st.y) return 'moved';
      continue;
    }
    if (gs.mapId !== map0) { settleAfterMapChange(ctx); return 'warped'; }
    if (gs.inBattle || gs.screen().hasTextBox) return 'interrupted';
    // the game took control of the player: a trainer walking over, or an arrow tile sliding us along
    if (!moved && ((gs.joyIgnore & 0xf0) || (gs.u8('wStatusFlags5') & 0x80))) {
      if (!waitControl(ctx)) return 'interrupted';
      if (gs.inBattle || gs.screen().hasTextBox || gs.u8('wCurOpponent')) return 'interrupted';
      if (gs.mapId !== map0) { settleAfterMapChange(ctx); return 'warped'; }
      return 'moved';
    }
    if (!moved) return 'blocked';
  }
  return 'ok';
}

function face(ctx: Ctx, tx: number, ty: number) {
  const dx = Math.sign(tx - ctx.gs.x), dy = Math.sign(ty - ctx.gs.y);
  const d = dx > 0 ? 'RIGHT' : dx < 0 ? 'LEFT' : dy > 0 ? 'DOWN' : 'UP';
  const want = { DOWN: 0, UP: 4, LEFT: 8, RIGHT: 0xc }[d];
  const facing = () => ctx.emu.mem[sym('wSpritePlayerStateData1FacingDirection')];
  // a tap right after a walk can be dropped; retry until the player actually faces the target
  for (let i = 0; i < 4 && (i === 0 || facing() !== want); i++) {
    waitWalkDone(ctx);
    ctx.emu.press(d, 3, 6);
  }
}

/** After interacting: wait for the game to respond, then say whether it is now asking or telling something. */
function afterInteract(ctx: Ctx, done: string): ActionResult {
  const { gs, emu } = ctx;
  // something showing: a text box, a menu, or a full-screen page (a Pokédex picture) with neither
  const showing = () => { const s = gs.screen(); return s.hasTextBox || !!s.cursor || detectMode(ctx) === 'dialog'; };
  for (let f = 0; f < 90 && !showing() && !gs.inBattle; f++) emu.frame();
  emu.wait(10);
  if (gs.inBattle) return { status: 'interrupted', message: `${done} A battle started.` };
  if (showing()) return { status: 'prompt', message: done };
  return { status: 'done', message: done };
}

export function runOverworld(ctx: Ctx, id: string): ActionResult {
  const { gs, emu } = ctx;
  const find = () => {
    if (id.startsWith('tile:')) { const [x, y] = id.slice(5).split(',').map(Number); return Number.isInteger(x) && Number.isInteger(y) ? tileCandidate(ctx, x, y) : null; }
    return candidates(ctx).find((c) => c.action.id === id) ?? null;
  };
  const c = find();
  if (!c) return { status: 'failed', message: id.startsWith('tile:') ? "Can't get there." : "That isn't possible any more." };
  const t = c.target;
  const map0 = gs.mapId;

  let res = walk(ctx, c.path);
  // replan to the same target from wherever we ended up: someone stepped in the way (once), or arrow tiles slid us along
  let blockedRetries = 1;
  for (let i = 0; i < 12 && (res === 'moved' || (res === 'blocked' && blockedRetries-- > 0)); i++) {
    if (res === 'blocked') emu.wait(20);
    const again = find();
    if (!again) break;
    res = walk(ctx, again.path);
  }
  if (res === 'interrupted') return { status: 'interrupted', message: interruption(ctx) ?? 'Something came up on the way.' };
  if (res === 'blocked' || res === 'moved') return { status: 'interrupted', message: 'Something is in the way.' };
  if (res === 'warped') return { status: 'done', message: `Now in ${pretty(gs.mapName)}.` };

  switch (t.kind) {
    case 'tile': {
      if (t.face) { face(ctx, t.face.x, t.face.y); return { status: 'done', message: 'Walked up to it.' }; }
      return { status: 'done', message: 'Walked there.' };
    }
    case 'warp': {
      emu.wait(20);
      // the last step onto the door square can be dropped (a press that only turns the player): step onto it first
      for (let i = 0; i < 3 && gs.mapId === map0 && adj(gs.x, gs.y, t.x, t.y) && !gs.screen().hasTextBox; i++) {
        const d = t.x > gs.x ? 'RIGHT' : t.x < gs.x ? 'LEFT' : t.y > gs.y ? 'DOWN' : 'UP';
        emu.hold(d, 16);
        emu.wait(20);
      }
      if (gs.mapId === map0) {
        // door mats and map-edge doors need a push toward the edge
        const last = c.path[c.path.length - 1]?.dir;
        for (const d of [last, 'down', 'up', 'left', 'right'].filter(Boolean) as Dir[]) {
          emu.hold(d.toUpperCase() as Button, 16);
          emu.wait(20);
          if (gs.mapId !== map0 || gs.screen().hasTextBox) break;
        }
      }
      if (gs.mapId !== map0) { settleAfterMapChange(ctx); return { status: 'done', message: `Now in ${pretty(gs.mapName)}.` }; }
      if (gs.screen().hasTextBox) return { status: 'prompt', message: 'Something came up at the door.' };
      return { status: 'interrupted', message: "The way through didn't open." };
    }
    case 'exit': {
      settleAfterMapChange(ctx);
      return gs.mapId !== map0 ? { status: 'done', message: `Now in ${pretty(gs.mapName)}.` } : { status: 'interrupted', message: 'Something is in the way.' };
    }
    case 'npc': {
      // People wander. Make sure we are still next to them before pressing A; if they moved, go to them once more.
      const where = () => gs.sprites().find((s) => s.index === t.index && !s.hidden);
      const beside = () => { const sp = where(); return !!sp && interactGoal(buildGrid(emu, ctx.rom, gs), sp.x, sp.y)(gs.x, gs.y); };
      for (let tries = 0; tries < 2 && !beside(); tries++) {
        const again = find();
        if (!again || walk(ctx, again.path) !== 'ok') break;
      }
      const sp = where();
      if (!sp || !beside()) return { status: 'interrupted', message: `${c.action.label}: they moved away.` };
      face(ctx, sp.x, sp.y);
      if (!t.talk) return { status: 'done', message: `${c.action.label}: there.` };
      tap(ctx, 'A', 20);
      const r = afterInteract(ctx, `${c.action.label}.`);
      // a talk that put nothing on screen did not happen (they stepped away as we pressed A)
      return r.status === 'done' ? { status: 'interrupted', message: `${c.action.label}: nothing happened. They may have moved.` } : r;
    }
    case 'sign': case 'hidden': {
      face(ctx, t.x, t.y);
      tap(ctx, 'A', 20);
      return afterInteract(ctx, `${c.action.label}.`);
    }
    case 'cut': case 'surf': {
      face(ctx, t.x, t.y);
      const mv = t.kind === 'cut' ? 'CUT' : 'SURF';
      if (!useFieldMove(ctx, slotWithMove(ctx, mv), mv)) return { status: 'failed', message: `Couldn't use ${mv} here.` };
      return afterInteract(ctx, `Used ${mv}.`);
    }
    case 'strength': {
      if (!useFieldMove(ctx, slotWithMove(ctx, 'STRENGTH'), 'STRENGTH')) return { status: 'failed', message: "Couldn't use STRENGTH here." };
      return afterInteract(ctx, 'Used STRENGTH.');
    }
    case 'start': {
      if (!openStart(ctx)) return { status: 'failed', message: "The menu didn't open." };
      return { status: 'prompt', message: 'Opened the menu.' };
    }
    case 'item': {
      if (!useItem(ctx, t.name)) { closeMenus(ctx); return { status: 'failed', message: `Couldn't use ${t.name}.` }; }
      return afterInteract(ctx, `Used ${t.name}.`);
    }
  }
}
