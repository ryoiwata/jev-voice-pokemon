import type { Action, ActionResult, Ctx } from './types.js';
import { detectMode } from '../game/mode.js';
import { listPrimitive, runPrimitive } from './primitive.js';
import { listMenu, runMenu } from './menu.js';
import { listOverworld, runOverworld } from './overworld.js';
import { isBattleMenu, listBattle, runBattle } from './battle.js';

export { tileAction } from './overworld.js';

/** Everything the player could do right now. Rebuilt from game memory each time; never presses anything. */
export function listActions(ctx: Ctx): Action[] {
  const mode = detectMode(ctx);
  const out: Action[] = [];
  if (mode === 'battle' && isBattleMenu(ctx)) out.push(...listBattle(ctx));
  else if (mode === 'dialog' || mode === 'battle') out.push(...listMenu(ctx));
  else if (mode === 'overworld') out.push(...listOverworld(ctx));
  out.push(...listPrimitive(ctx));
  return out;
}

const OVERWORLD_ID = /^(warp|exit|npc|sign|hidden|scenery|startmenu|cut|surf|item|tile):|^(strength|start)$/; // positional ids end in @<map id>

/**
 * Carry out one listed action. The id is looked up in a fresh list first, so an action that
 * stopped being possible (the screen changed, someone walked off) fails without pressing anything.
 */
export function runAction(ctx: Ctx, id: string, arg?: unknown): ActionResult {
  const mode = detectMode(ctx);
  // a walk to a clicked tile is the one action that is never listed
  if (id.startsWith('tile:')) return mode === 'overworld' ? runOverworld(ctx, id) : { status: 'failed', message: "Can't walk right now." };
  const a = listActions(ctx).find((x) => x.id === id);
  if (!a) return { status: 'failed', message: "That isn't possible any more." };
  if (mode === 'overworld' && OVERWORLD_ID.test(id)) return runOverworld(ctx, id);
  if (a.kind === 'press' || a.kind === 'steps') return runPrimitive(ctx, a, arg);
  if (mode === 'battle' && isBattleMenu(ctx) && a.id !== 'menu:back') return runBattle(ctx, a);
  if (a.kind === 'menu' || a.kind === 'text' || a.kind === 'name') return runMenu(ctx, a, arg);
  return runPrimitive(ctx, a, arg);
}
