import type { Action, ActionResult, Ctx } from './types.js';
import { detectMode } from '../game/mode.js';
import { advanceText, confirmA, cursorTo, cursorToIndex, isNamingScreen, readMenuOptions, tap, typeName, type Label } from './nav.js';

/** Text on screen that means the choice in front of the player is hard to undo. */
const COSTLY_SCREEN = /forget|toss|release|Would you like to SAVE|overwritten/i;
const COSTLY_LABEL = /^(TOSS|RELEASE)$/;

const screenText = (ctx: Ctx) => ctx.gs.screen().rows.join(' ').replace(/[┌─┐│└┘▶▷▼]/g, ' ').replace(/\s+/g, ' ');

/** The options of the menu that has the cursor, with repeated labels numbered ("-", "- (2)"). */
function options(ctx: Ctx): Label[] {
  const seen = new Map<string, number>();
  return readMenuOptions(ctx).map((o) => {
    const n = (seen.get(o.text) ?? 0) + 1;
    seen.set(o.text, n);
    return n > 1 ? { ...o, text: `${o.text} (${n})` } : o;
  });
}

/** What the player can do with the text box, menu or naming screen that is showing. */
export function listMenu(ctx: Ctx): Action[] {
  const s = ctx.gs.screen();
  if (isNamingScreen(ctx)) return [{ id: 'name', kind: 'name', label: 'Type a name' }];
  const out: Action[] = [];
  if (s.cursor) {
    const risky = COSTLY_SCREEN.test(screenText(ctx));
    const opts = options(ctx);
    for (const o of opts) out.push({ id: `menu:${o.text}`, kind: 'menu', label: o.text, ...(risky || COSTLY_LABEL.test(o.text) ? { costly: true } : {}) });
    if (s.moreBelow) {
      // a scrolling list: when it is the bag, the rest of it is known from memory
      const bag = ctx.gs.bag().map((i) => i.name);
      const shown = new Set(opts.map((o) => o.text));
      if (opts.length && opts.every((o) => o.text === 'CANCEL' || bag.includes(o.text))) {
        for (const name of bag) if (!shown.has(name)) out.push({ id: `menu:${name}`, kind: 'menu', label: name, ...(risky ? { costly: true } : {}) });
      }
      out.push({ id: 'menu:more', kind: 'menu', label: 'Scroll down the list' });
    }
    if (opts.length) out.push({ id: 'menu:back', kind: 'menu', label: 'Go back / close this menu' });
  } else if (s.hasTextBox && s.waitingForA) {
    out.push({ id: 'text:next', kind: 'text', label: 'Continue' });
  }
  return out;
}

/** Let text finish printing so the screen can be read reliably. */
function settle(ctx: Ctx, maxFrames = 120) {
  let last = '', stable = 0;
  for (let f = 0; f < maxFrames && stable < 8; f++) {
    const now = ctx.gs.screen().rows.join('');
    stable = now === last ? stable + 1 : 0;
    last = now;
    ctx.emu.frame();
  }
}

/** After a choice: is the game asking the player something else now? */
export function outcome(ctx: Ctx, done: string): ActionResult {
  settle(ctx);
  // a screen change (fade to the naming keyboard, a menu closing) passes through frames with nothing on them
  for (let f = 0; f < 240; f++) {
    const m = detectMode(ctx);
    const sc = ctx.gs.screen();
    // (a blank screen mid-fade also reads as "dialog": wait for a text box, a cursor or the keyboard to show)
    if (m === 'overworld' || m === 'battle' || (m === 'dialog' && (sc.cursor || (sc.hasTextBox && !isNamingScreen(ctx))))) break;
    ctx.emu.frame();
  }
  settle(ctx, 60);
  const s = ctx.gs.screen();
  if (isNamingScreen(ctx)) return { status: 'prompt', message: `${done} Now it wants a name.` };
  if (s.cursor) return { status: 'prompt', message: `${done} Now choose.` };
  return { status: 'done', message: done };
}

export function runMenu(ctx: Ctx, a: Action, arg?: unknown): ActionResult {
  if (a.id === 'text:next') { advanceText(ctx); return outcome(ctx, 'Continued.'); }

  if (a.id === 'name') {
    const max = ctx.gs.screen().rows.some((r) => /NICKNAME/.test(r)) ? 10 : 7;
    const text = String((arg as { text?: unknown } | undefined)?.text ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, max);
    if (!text) return { status: 'failed', message: 'I need a name with letters in it.' };
    typeName(ctx, text);
    return outcome(ctx, `Typed ${text}.`);
  }

  if (a.id === 'menu:back') { tap(ctx, 'B', 15); return outcome(ctx, 'Went back.'); }
  if (a.id === 'menu:more') {
    for (let i = 0; i <= ctx.gs.menu().max; i++) tap(ctx, 'DOWN', 6);
    return { status: 'prompt', message: 'Scrolled down.' };
  }

  settle(ctx, 60);
  const target = options(ctx).find((o) => `menu:${o.text}` === a.id);
  if (!target) {
    // not on screen: an entry further down a scrolling list
    if (!cursorTo(ctx, a.label, 80)) return { status: 'failed', message: `I couldn't find ${a.label} in the list.` };
  } else if (!(target.index !== undefined && cursorToIndex(ctx, target.index))) {
    // move by rows (labels can repeat across the screen)
    for (let i = 0; i < 20; i++) {
      const cur = ctx.gs.screen().cursor;
      if (!cur) break;
      if (cur.y === target.y && Math.abs(cur.x - (target.x - 1)) <= 1) break;
      if (cur.y > target.y) tap(ctx, 'UP', 6);
      else if (cur.y < target.y) tap(ctx, 'DOWN', 6);
      else if (cur.x > target.x - 1) tap(ctx, 'LEFT', 6);
      else tap(ctx, 'RIGHT', 6);
    }
  }
  confirmA(ctx);
  return outcome(ctx, `Chose ${a.label}.`);
}
