// Mechanical screen-reading and button helpers, kept from the reference (src/agent/{context,menus,field,dialog}.ts).
// They move a cursor to something that is ON SCREEN; what to pick is always decided by the player.
import type { Button } from '../emu/emulator.js';
import type { Ctx } from './types.js';
import { sym } from '../game/symbols.js';

/** Tap a button and let the game react. */
export function tap(ctx: Ctx, b: Button, settle = 10) {
  ctx.emu.press(b, 6, settle);
}

export interface Label { text: string; x: number; y: number; index?: number }

/** Party menu: names on rows 0,2,4.. with the cursor on the row below each name. */
export function isPartyMenu(ctx: Ctx): boolean {
  const s = ctx.gs.screen();
  const party = ctx.gs.party();
  return !!s.cursor && s.cursor.x === 0 && party.length > 0 && s.rows[0].slice(3).startsWith(party[0].nickname);
}

/** Move the menu cursor to a list index using the game's own cursor register. */
export function cursorToIndex(ctx: Ctx, index: number): boolean {
  for (let i = 0; i < 20; i++) {
    const cur = ctx.gs.menu().current;
    if (cur === index) return true;
    tap(ctx, cur > index ? 'UP' : 'DOWN', 6);
  }
  return ctx.gs.menu().current === index;
}

/** Finds `text` on screen; with several matches, prefers the one closest to the cursor. */
export function findLabel(ctx: Ctx, text: string): Label | null {
  const s = ctx.gs.screen();
  const want = text.toUpperCase();
  const hits: Label[] = [];
  for (let y = 0; y < s.rows.length; y++) {
    // a tile can decode to several chars (POKé): map string positions back to tile columns
    const cells = s.cells[y];
    const col: number[] = [];
    cells.forEach((c, x) => { for (let k = 0; k < c.length; k++) col.push(x); });
    const row = cells.join('').toUpperCase();
    for (let i = row.indexOf(want); i >= 0; i = row.indexOf(want, i + 1)) hits.push({ text, x: col[i] ?? i, y });
  }
  if (!hits.length) return null;
  const c = s.cursor ?? { x: 0, y: 17 };
  hits.sort((a, b) => Math.abs(a.y - c.y) * 4 + Math.abs(a.x - c.x) - (Math.abs(b.y - c.y) * 4 + Math.abs(b.x - c.x)));
  return hits[0];
}

/** Moves the ▶ cursor next to `text` (scrolling down if needed). Returns false if not reachable. */
export function cursorTo(ctx: Ctx, text: string, maxPresses = 30): boolean {
  let scrolled = 0, waited = 0;
  for (let i = 0; i < maxPresses; i++) {
    const s = ctx.gs.screen();
    const cur = s.cursor;
    const lab = findLabel(ctx, text);
    if (!cur) { ctx.emu.wait(4); continue; }
    if (!lab) {
      // give the menu time to draw, then assume a scrolling list
      if (waited < 45) { waited += 5; ctx.emu.wait(5); i--; continue; }
      if (scrolled++ > Math.max(25, maxPresses - 5)) return false;
      tap(ctx, 'DOWN', 6);
      continue;
    }
    const tx = lab.x - 1;
    if (cur.y === lab.y && Math.abs(cur.x - tx) <= 1) return true;
    if (cur.y > lab.y) tap(ctx, 'UP', 6);
    else if (cur.y < lab.y) tap(ctx, 'DOWN', 6);
    else if (cur.x > tx) tap(ctx, 'LEFT', 6);
    else tap(ctx, 'RIGHT', 6);
  }
  return false;
}

export function select(ctx: Ctx, text: string): boolean {
  if (!cursorTo(ctx, text)) return false;
  return confirmA(ctx);
}

/** Reads the options of the menu that currently owns the ▶ cursor. */
const CLOSE_SENTINEL = 'Close this menu';
/** a menu label: a word, "-", or an elevator floor (B1F, 5F) */
const LABEL = /[A-Za-z]{2,}|^-$|^B?\d{1,2}F$/;

export function readMenuOptions(ctx: Ctx): Label[] {
  const s = ctx.gs.screen();
  if (!s.cursor) return [];
  if (isPartyMenu(ctx)) return ctx.gs.party().map((p, i) => ({ text: p.nickname, x: 3, y: i * 2, index: i }));
  const { topY, topX, max } = ctx.gs.menu();
  // A small box (YES/NO) can sit on top of a bigger one, so the label ends at the box's own right edge:
  // "▶YES│IME 0 00│" is YES, not "YES IME".
  const clean = (t: string) => t.replace(/[▶▷▼]/g, ' ').replace(/^[\s┌─┐│└┘]+/, '').replace(/[┌─┐│└┘].*$/, '').replace(/\s{2,}.*$/, '').trim();
  const opts: Label[] = [];
  // Try register layout first (step 2, then 1) — only when the cursor really is in that column (else text
  // drawn behind a small box, like a YES/NO over a patterned floor, gets read instead of the options)
  for (const step of s.cursor.x === topX ? [2, 1] : []) {
    const tmp: Label[] = [];
    for (let i = 0; i <= max && i < 12; i++) {
      const y = topY + i * step;
      if (y >= 18) break;
      const text = clean(s.cells[y].slice(topX + 1).join(''));
      if (text) tmp.push({ text, x: topX + 1, y, index: i });
    }
    const wordy = tmp.every((t) => LABEL.test(t.text));
    if (wordy && tmp.length === max + 1 && new Set(tmp.map((t) => t.text)).size === tmp.length) return tmp;
  }
  // Fallback: rows of the cursor's box, in the cursor column, same spacing as the register layout
  const col = s.cursor.x;
  const inBox = (y: number) => /[│ ▶▷]/.test(s.cells[y][col] ?? '') && !/[─┌└┐┘]/.test(s.cells[y][col] ?? '');
  let top = s.cursor.y, bot = s.cursor.y;
  while (top > 0 && inBox(top - 1)) top--;
  while (bot < 17 && inBox(bot + 1)) bot++;
  for (let y = top; y <= bot; y++) {
    const text = clean(s.cells[y].slice(col + 1).join(''));
    if (text && LABEL.test(text)) opts.push({ text, x: col + 1, y });
  }
  return opts;
}
/** Press A and verify the screen reacted; retry a few times (some menus drop early presses). */
export function confirmA(ctx: Ctx, tries = 3): boolean {
  for (let i = 0; i < tries; i++) {
    const before = ctx.gs.screen().rows.join('') + JSON.stringify(ctx.gs.screen().cursor);
    tap(ctx, 'A', 4);
    for (let f = 0; f < 40; f++) {
      const now = ctx.gs.screen().rows.join('') + JSON.stringify(ctx.gs.screen().cursor);
      if (now !== before || ctx.gs.inBattle === 0 && f > 30) { ctx.emu.wait(4); return true; }
      ctx.emu.frame();
    }
  }
  return false;
}

/** Wait until the tilemap differs from `before` (menu closed / next screen drawn). */
export function waitForChange(ctx: Ctx, before: string, maxFrames: number) {
  for (let i = 0; i < maxFrames; i++) {
    if (ctx.gs.screen().rows.join('') !== before) { ctx.emu.wait(4); return; }
    ctx.emu.frame();
  }
}

export function openStart(ctx: Ctx): boolean {
  const open = () => ctx.gs.screen().rows.some((r) => r.includes('EXIT'));
  for (let i = 0; i < 3; i++) {
    tap(ctx, 'START', 20);
    // the menu takes a moment to draw: wait for it before pressing START again (that would close it)
    for (let f = 0; f < 90 && !open(); f += 5) ctx.emu.wait(5);
    if (open()) return true;
    if (ctx.gs.screen().nonMapTiles > 0) { tap(ctx, 'B', 20); ctx.emu.wait(20); } // something else opened: back out first
  }
  return false;
}

export function closeMenus(ctx: Ctx) {
  for (let i = 0; i < 6 && ctx.gs.screen().nonMapTiles > 0; i++) tap(ctx, 'B', 12);
}

/** START → POKéMON → slot → field move (CUT/SURF/STRENGTH/FLASH/...). */
export function useFieldMove(ctx: Ctx, slot: number, move: string): boolean {
  if (!openStart(ctx) || !select(ctx, 'POKéMON')) { closeMenus(ctx); return false; }
  // the party screen takes a moment to draw (a full team takes longer)
  for (let f = 0; f < 150 && !ctx.gs.screen().rows.some((r) => r.includes('Choose a')); f += 5) ctx.emu.wait(5);
  ctx.emu.wait(20);
  if (!cursorToIndex(ctx, slot)) { closeMenus(ctx); return false; }
  const before = ctx.gs.screen().rows.join('');
  tap(ctx, 'A', 4);
  waitForChange(ctx, before, 40);
  if (!select(ctx, move)) { closeMenus(ctx); return false; }
  ctx.emu.wait(30);
  return true;
}

/** START → ITEM → item → USE. Follow-up prompts (which Pokémon, forget which move...) go through the normal Jev menu loop. */
export function useItem(ctx: Ctx, item: string): boolean {
  if (!openStart(ctx) || !select(ctx, 'ITEM')) { closeMenus(ctx); return false; }
  ctx.emu.wait(20);
  if (!cursorTo(ctx, item)) { closeMenus(ctx); return false; }
  // the USE / TOSS box takes a moment to appear (key items skip it)
  const box = () => ctx.gs.screen().rows.some((r) => r.includes('TOSS'));
  openItemBox(ctx, box);
  if (box()) select(ctx, 'USE');
  return true;
}

/** Press A on the highlighted bag item until its USE/TOSS box shows (the list ignores A for a moment after drawing). */
function openItemBox(ctx: Ctx, box: () => boolean) {
  ctx.emu.wait(20);
  for (let tries = 0; tries < 2 && !box(); tries++) {
    const before = ctx.gs.screen().rows.join('');
    tap(ctx, 'A', 4);
    for (let f = 0; f < 90 && !box(); f += 5) { ctx.emu.wait(5); if (ctx.gs.screen().rows.join('') !== before && !box() && f > 60) break; }
  }
}

/** Open the bag on an item and choose TOSS with quantity 1; the game's "Is it OK to toss" YES/NO is left for Jev. */
export function tossItem(ctx: Ctx, item: string): boolean {
  if (!openStart(ctx) || !select(ctx, 'ITEM')) { closeMenus(ctx); return false; }
  if (!item) return true; // just the bag list: which item, and USE / TOSS, are Jev's menu choices
  ctx.emu.wait(20);
  if (!cursorTo(ctx, item)) { closeMenus(ctx); return false; }
  const box = () => ctx.gs.screen().rows.some((r) => r.includes('TOSS'));
  openItemBox(ctx, box);
  if (!box() || !select(ctx, 'TOSS')) { closeMenus(ctx); return false; }
  ctx.emu.wait(20);
  tap(ctx, 'A', 20); // quantity ×1
  return true;
}

/** Party slot of a Pokémon that knows `move`, or -1. */
export function slotWithMove(ctx: Ctx, move: string): number {
  return ctx.gs.party().findIndex((p) => p.moves.some((m) => m.name === move));
}

export function isNamingScreen(ctx: Ctx): boolean {
  const rows = ctx.gs.screen().rows;
  return rows.some((r) => /A B C D E F G H I/.test(r.replace(/[▶▷]/g, ' ')));
}

/** Types a name on the naming keyboard by reading letter positions off the screen. */
export function typeName(ctx: Ctx, name: string) {
  const rows = () => ctx.gs.screen().rows;
  // Only type if the name field is empty (otherwise accept what's there). The field is row 2 from column 10
  // on both the player/rival and the nickname screens (naming_screen.asm).
  const typed = (rows()[2] ?? '').slice(10).trim();
  if (typed.replace(/[_\s]/g, '')) { tap(ctx, 'START', 20); return; }
  for (const ch of name) {
    for (let i = 0; i < 20; i++) {
      const s = ctx.gs.screen();
      let pos: { x: number; y: number } | null = null;
      for (let y = 4; y < 16 && !pos; y++) {
        for (let x = 0; x < 20; x++) if (s.rows[y][x] === ch && (x === 0 || s.rows[y][x - 1] !== ch)) { pos = { x, y }; break; }
      }
      const cur = s.cursor;
      if (!pos || !cur) break;
      if (cur.y === pos.y && cur.x === pos.x - 1) { tap(ctx, 'A', 8); break; }
      if (cur.y > pos.y) tap(ctx, 'UP', 6);
      else if (cur.y < pos.y) tap(ctx, 'DOWN', 6);
      else if (cur.x > pos.x - 1) tap(ctx, 'LEFT', 6);
      else tap(ctx, 'RIGHT', 6);
    }
  }
  tap(ctx, 'START', 30);
}

const MAX_NICK = 10;
/** True when the CPU is inside the game's menu input loop (HandleMenuInput), i.e. a menu is accepting input. */
export function menuActive(ctx: Ctx): boolean {
  const core = ctx.emu.core, lo = sym('HandleMenuInput'), hi = sym('PlaceMenuCursor');
  for (let f = 0; f < 4; f++) {
    const sp = core.stackPointer;
    for (let i = 0; i < 12; i++) {
      const ret = core.memoryRead(sp + 2 * i) | (core.memoryRead(sp + 2 * i + 1) << 8);
      if (ret >= lo && ret < hi) return true;
    }
    ctx.emu.frame();
  }
  return false;
}

/** Press A to advance, then let text print until a prompt/menu shows or the box closes. */
export function advanceText(ctx: Ctx, maxFrames = 150) {
  tap(ctx, 'A', 4);
  for (let i = 0; i < maxFrames; i++) {
    const s = ctx.gs.screen();
    if (s.waitingForA || s.cursor || !s.hasTextBox) return;
    ctx.emu.frame();
  }
}

