import { describe, it, expect } from 'vitest';
import { listActions, runAction } from '../../src/actions/index.js';
import { GameClient } from '../../src/server/game.js';
import { hasFixture, boot, ROM_PATH } from '../helpers/rom.js';

describe.skipIf(!hasFixture('fx-bedroom'))('primitive actions', () => {
  it('lists the eight buttons and four step directions in the overworld', () => {
    const ids = listActions(boot('fx-bedroom')).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['press:A', 'press:START', 'press:DOWN', 'steps:left', 'steps:up', 'wait']));
  });

  it('does not offer steps while a menu is open', () => {
    const ids = listActions(boot('fx-menu')).map((a) => a.id);
    expect(ids).toContain('press:A');
    expect(ids.some((id) => id.startsWith('steps:'))).toBe(false);
  });

  it('steps moves the player that many tiles, or stops at a wall', () => {
    const ctx = boot('fx-bedroom'); const x0 = ctx.gs.x;
    const r = runAction(ctx, 'steps:left', 2);
    expect(['done', 'interrupted']).toContain(r.status);
    if (r.status === 'done') expect(ctx.gs.x).toBe(x0 - 2);
    else expect(ctx.gs.x).toBeGreaterThan(x0 - 2);
  });

  it('walking into a wall is reported, not silently ignored', () => {
    const ctx = boot('fx-bedroom');
    const r = runAction(ctx, 'steps:up', 20);
    expect(r.status).toBe('interrupted');
  });

  it('an unknown id fails cleanly', () => {
    expect(runAction(boot('fx-bedroom'), 'npc:99').status).toBe('failed');
  });

  it('stop ends a running action with status stopped', async () => {
    const g = await GameClient.start({ romPath: ROM_PATH, resume: 'fixtures/fx-bedroom', autosave: false });
    const p = g.run('wait');
    setTimeout(() => g.stop(), 100);
    expect((await p).status).toBe('stopped');
    expect(g.state.running).toBeNull();
    await g.shutdown();
  });

  it('a new action replaces the one in progress', async () => {
    const g = await GameClient.start({ romPath: ROM_PATH, resume: 'fixtures/fx-bedroom', autosave: false });
    const first = g.run('wait');
    const second = g.run('press:B');
    expect((await first).status).toBe('stopped');
    expect((await second).status).toBe('done');
    await g.shutdown();
  });

describe.skipIf(!hasFixture('fx-bedroom'))('stepping forward', () => {
  it('offers a step forward and takes it the way the player is facing', () => {
    const ctx = boot('fx-bedroom');
    expect(listActions(ctx).some((a) => a.id === 'steps:forward')).toBe(true);
    runAction(ctx, 'steps:left', 1);
    expect(ctx.gs.facing).toBe('left');
    const x = ctx.gs.x;
    const r = runAction(ctx, 'steps:forward', 1);
    expect(r).toEqual({ status: 'done', message: 'Walked 1 step left.' });
    expect(ctx.gs.x).toBe(x - 1);
  });
  it('walking until something is in the way ends as done, not as a failure', () => {
    const ctx = boot('fx-bedroom');
    const r = runAction(ctx, 'steps:left', 20);
    expect(r.status).toBe('done');
    expect(r.message).toMatch(/^Walked \d+ steps? left, as far as it goes\.$/);
  });
  it('a plain count that is cut short is still reported as cut short', () => {
    const ctx = boot('fx-bedroom');
    expect(runAction(ctx, 'steps:left', 15).status).toBe('interrupted');
  });
});
});

describe.skipIf(!hasFixture('fx-lab'))('walking in a direction goes around a person in the way', () => {
  // Oak's lab: the player is at (5,3), the rival stands at (4,3) directly to the left, Oak at (5,2) directly above.
  it('"left two" ends two squares to the left, having walked around the rival', () => {
    const ctx = boot('fx-lab');
    expect([ctx.gs.x, ctx.gs.y]).toEqual([5, 3]);
    const r = runAction(ctx, 'steps:left', 2);
    expect(r).toEqual({ status: 'done', message: 'Walked 2 steps left, going around someone in the way.' });
    expect([ctx.gs.x, ctx.gs.y]).toEqual([3, 3]);
  });
  it('one step into a person is not turned into a walk around them', () => {
    const ctx = boot('fx-lab');
    const r = runAction(ctx, 'steps:left', 1);
    expect(r.status).toBe('interrupted');
    expect(r.message).toMatch(/in the way/);
    expect([ctx.gs.x, ctx.gs.y]).toEqual([5, 3]);
  });
  it('"keep going left" passes the rival and carries on to the wall', () => {
    const ctx = boot('fx-lab');
    const r = runAction(ctx, 'steps:left', 20);
    expect(r.status).toBe('done');
    expect([ctx.gs.x, ctx.gs.y]).toEqual([0, 3]);
    expect(r.message).toMatch(/as far as it goes/);
  });
  it('never talks to the person or opens anything on the way round', () => {
    const ctx = boot('fx-lab');
    runAction(ctx, 'steps:left', 2);
    expect(ctx.gs.screen().hasTextBox).toBe(false);
  });
});
