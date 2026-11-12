import { describe, it, expect } from 'vitest';
import { listActions, runAction } from '../../src/actions/index.js';
import { hasFixture, boot } from '../helpers/rom.js';

describe.skipIf(!hasFixture('fx-battle'))('trainer battle actions', () => {
  it('lists the active Pokémon’s moves, and no ball or run in a trainer battle', () => {
    const ctx = boot('fx-battle'); const acts = listActions(ctx);
    const moves = ctx.gs.party()[0].moves.map((m) => `move:${m.name}`);
    expect(moves.length).toBeGreaterThan(0);
    expect(acts.map((a) => a.id)).toEqual(expect.arrayContaining(moves));
    expect(acts.some((a) => a.kind === 'run' || a.id.startsWith('ball:'))).toBe(false);
    expect(acts.every((a) => !/damage|effective|chance|%/i.test(a.label))).toBe(true);
  });

  it('using a move spends its PP', () => {
    const ctx = boot('fx-battle'); const m = ctx.gs.party()[0].moves[0];
    expect(runAction(ctx, `move:${m.name}`).status).toBe('done');
    for (let i = 0; i < 900 && ctx.gs.party()[0].moves[0].pp === m.pp; i++) ctx.emu.frame();
    expect(ctx.gs.party()[0].moves[0].pp).toBe(m.pp - 1);
  });

  it('a move the Pokémon does not know fails without pressing anything', () => {
    const ctx = boot('fx-battle'); const f0 = ctx.emu.frames;
    expect(runAction(ctx, 'move:HYPER BEAM').status).toBe('failed');
    expect(ctx.emu.frames).toBe(f0);
  });
});

describe.skipIf(!hasFixture('fx-wild'))('wild battle actions', () => {
  it('offers running away, and running ends the battle', () => {
    const ctx = boot('fx-wild');
    expect(listActions(ctx).map((a) => a.id)).toContain('run');
    runAction(ctx, 'run');
    for (let i = 0; i < 900 && ctx.gs.inBattle; i++) { if (ctx.gs.screen().waitingForA) ctx.emu.press('A'); else ctx.emu.frame(); }
    expect(ctx.gs.inBattle).toBe(0);
  });
});

import { AutoAdvance } from '../../src/actions/advance.js';
import { detectMode } from '../../src/game/mode.js';

describe.skipIf(!hasFixture('fx-battle'))('battle text', () => {
  /** Play turns until the battle shows text that waits for A (a critical hit, a faint, a level-up...). */
  function toWaitingText() {
    const ctx = boot('fx-battle');
    for (let i = 0; i < 40000; i++) {
      const s = ctx.gs.screen();
      if (detectMode(ctx) === 'battle' && s.waitingForA && !s.cursor) return ctx;
      const move = listActions(ctx).find((a) => a.kind === 'move');
      if (move) runAction(ctx, move.id); else ctx.emu.frame();
    }
    throw new Error('never reached waiting battle text');
  }

  it('auto-advance continues battle text that waits for A, after the reading time', () => {
    const ctx = toWaitingText();
    const adv = new AutoAdvance();
    expect(adv.due(ctx, 1000, 1500)).toBe(false);   // first sight of this text: start the clock
    expect(adv.due(ctx, 2000, 1500)).toBe(false);   // not read yet
    expect(adv.due(ctx, 2600, 1500)).toBe(true);    // 1.6 s unchanged: continue
    expect(adv.due(ctx, 2700, 1500)).toBe(false);   // and the clock starts over
  });

  it('auto-advance never fires while the battle menu is waiting for a choice', () => {
    const ctx = boot('fx-battle');
    const adv = new AutoAdvance();
    adv.due(ctx, 0, 100);
    expect(adv.due(ctx, 10_000, 100)).toBe(false);
  });
});
