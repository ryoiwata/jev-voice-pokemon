import type { Action, ActionResult, Ctx } from './types.js';
import { detectMode } from '../game/mode.js';
import { listPrimitive, runPrimitive } from './primitive.js';
import { listMenu, runMenu } from './menu.js';

/** Everything the player could do right now. Rebuilt from game memory each time; never presses anything. */
export function listActions(ctx: Ctx): Action[] {
  const mode = detectMode(ctx);
  const out: Action[] = [];
  if (mode === 'dialog') out.push(...listMenu(ctx));
  out.push(...listPrimitive(ctx));
  return out;
}

/**
 * Carry out one listed action. The id is looked up in a fresh list first, so an action that
 * stopped being possible (the screen changed, someone walked off) fails without pressing anything.
 */
export function runAction(ctx: Ctx, id: string, arg?: unknown): ActionResult {
  const a = listActions(ctx).find((x) => x.id === id);
  if (!a) return { status: 'failed', message: "That isn't possible any more." };
  switch (a.kind) {
    case 'menu': case 'text': case 'name': return runMenu(ctx, a, arg);
    default: return runPrimitive(ctx, a, arg);
  }
}
