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
});
