import type { Action, ActionResult, Ctx } from './types.js';

export function listActions(_ctx: Ctx): Action[] {
  return [];
}

export function runAction(_ctx: Ctx, _id: string, _arg?: unknown): ActionResult {
  return { status: 'failed', message: "That isn't possible any more." };
}
