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
