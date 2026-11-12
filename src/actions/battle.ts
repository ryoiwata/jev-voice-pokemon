// What the player can do at the battle menu, and the button sequences for each.
// The sequences come from the reference (src/agent/battle.ts); its damage estimates, catch odds and
// "which option is best" filtering are gone. Every legal choice is offered, good or bad.
import type { Action, ActionResult, Ctx } from './types.js';
import { confirmA, cursorTo, cursorToIndex, findLabel, select, tap } from './nav.js';
import { outcome } from './menu.js';

const BALL = /BALL$/;

function isSafari(ctx: Ctx) {
  return ctx.gs.u8('wBattleType') === 2 && !!findLabel(ctx, 'BAIT') && !!findLabel(ctx, 'RUN');
}

/** The FIGHT / PKMN / ITEM / RUN menu is showing and waiting. */
export function isBattleMenu(ctx: Ctx): boolean {
  const s = ctx.gs.screen();
  return !!s.cursor && !!findLabel(ctx, 'RUN') && (!!findLabel(ctx, 'FIGHT') || isSafari(ctx));
}

function waitForBag(ctx: Ctx): boolean {
  const names = ctx.gs.bag().map((i) => i.name);
  for (let i = 0; i < 180; i++) {
    const t = ctx.gs.screen().rows.join(' ');
    if (/×|CANCEL/.test(t) || names.some((n) => t.includes(n))) { ctx.emu.wait(6); return true; }
    ctx.emu.wait(1);
  }
  return false;
}

const SAFARI: [id: string, label: string, onScreen: string][] = [
  ['safari:ball', 'Throw a Safari Ball', 'BALL'], ['safari:bait', 'Throw bait', 'BAIT'], ['safari:rock', 'Throw a rock', 'THROW ROCK'], ['run', 'Run away', 'RUN'],
];

export function listBattle(ctx: Ctx): Action[] {
  const { gs } = ctx;
  if (isSafari(ctx)) return SAFARI.map(([id, label]) => ({ id, kind: id === 'run' ? 'run' : 'item', label }));
  const b = gs.battle();
  const out: Action[] = [];
  for (const mv of b.player.moves) out.push({ id: `move:${mv.name}`, kind: 'move', label: `Use ${mv.name}` });
  for (const p of gs.party()) {
    if (p.slot === b.player.slot || p.hp === 0) continue;
    out.push({ id: `switch:${p.slot}`, kind: 'switch', label: `Switch to ${p.nickname}` });
  }
  for (const it of gs.bag()) {
    if (BALL.test(it.name)) {
      if (b.kind === 'wild') out.push({ id: `ball:${it.name}`, kind: 'item', label: `Throw ${it.name}`, ...(it.name === 'MASTER BALL' ? { costly: true } : {}) });
    } else out.push({ id: `item:${it.name}`, kind: 'item', label: `Use ${it.name}` });
  }
  if (b.kind === 'wild') out.push({ id: 'run', kind: 'run', label: 'Run away' });
  return out;
}

/** Open the bag from the battle menu and put the cursor on an item. */
function pickFromBag(ctx: Ctx, name: string): ActionResult | null {
  if (!select(ctx, 'ITEM') || !waitForBag(ctx)) return { status: 'failed', message: "The bag didn't open." };
  if (!cursorTo(ctx, name, 80)) { tap(ctx, 'B', 20); return { status: 'failed', message: `I couldn't find ${name} in the bag.` }; }
  confirmA(ctx);
  return null;
}

export function runBattle(ctx: Ctx, a: Action): ActionResult {
  const { gs } = ctx;
  const safari = SAFARI.find(([id]) => id === a.id);
  if (safari && isSafari(ctx)) { select(ctx, safari[2]); return outcome(ctx, `${a.label}.`); }

  const [kind, rest] = [a.id.split(':')[0], a.id.slice(a.id.indexOf(':') + 1)];
  switch (kind) {
    case 'move': {
      const mv = gs.battle().player.moves.find((m) => m.name === rest);
      if (mv && mv.pp === 0 && gs.battle().player.moves.some((m) => m.pp > 0)) return { status: 'failed', message: `No PP left for ${rest}.` };
      if (!select(ctx, 'FIGHT')) return { status: 'failed', message: "The move list didn't open." };
      if (!cursorTo(ctx, rest)) { tap(ctx, 'B', 20); return { status: 'failed', message: `I couldn't find ${rest}.` }; }
      confirmA(ctx);
      return { status: 'done', message: `Used ${rest}.` };
    }
    case 'switch': {
      const slot = +rest;
      const who = gs.party()[slot]?.nickname ?? 'it';
      if (!select(ctx, 'PKMN')) return { status: 'failed', message: "The party list didn't open." };
      ctx.emu.wait(20);
      cursorToIndex(ctx, slot);
      confirmA(ctx);
      if (!select(ctx, 'SWITCH')) { tap(ctx, 'B', 20); tap(ctx, 'B', 20); return { status: 'failed', message: `Couldn't switch to ${who}.` }; }
      return { status: 'done', message: `Switched to ${who}.` };
    }
    case 'ball': {
      const err = pickFromBag(ctx, rest);
      return err ?? { status: 'done', message: `Threw ${rest}.` };
    }
    case 'item': {
      const err = pickFromBag(ctx, rest);
      // if the game now asks which Pokémon, that question is the player's to answer
      return err ?? outcome(ctx, `Chose ${rest}.`);
    }
    case 'run': {
      if (!select(ctx, 'RUN')) return { status: 'failed', message: "Couldn't run." };
      return { status: 'done', message: 'Ran.' };
    }
  }
  return { status: 'failed', message: "That isn't possible any more." };
}
