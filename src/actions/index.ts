import type { Action, ActionResult, Ctx } from './types.js';
import { listPrimitive, runPrimitive } from './primitive.js';

/** Everything the player could do right now. Rebuilt from game memory each time. */
export function listActions(ctx: Ctx): Action[] {
  return [...listPrimitive(ctx)];
}

/**
 * Carry out one listed action. The id is looked up in a fresh list first, so an action that
 * stopped being possible (the screen changed, someone walked off) fails without pressing anything.
 */
export function runAction(ctx: Ctx, id: string, arg?: unknown): ActionResult {
  const a = listActions(ctx).find((x) => x.id === id);
  if (!a) return { status: 'failed', message: "That isn't possible any more." };
  return runPrimitive(ctx, a, arg);
}
