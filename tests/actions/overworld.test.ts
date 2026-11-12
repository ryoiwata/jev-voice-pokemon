import { describe, it, expect } from 'vitest';
import { listActions, runAction, tileAction } from '../../src/actions/index.js';
import { hasFixture, boot } from '../helpers/rom.js';

const POSITIONAL = ['door', 'interact', 'go'];

describe.skipIf(!hasFixture('fx-bedroom'))('overworld actions', () => {
  it('lists the stairs and the PC in the bedroom, nearest first, with no strategy text', () => {
    const acts = listActions(boot('fx-bedroom')).filter((a) => POSITIONAL.includes(a.kind) && a.at);
    expect(acts.some((a) => a.id.startsWith('warp:') && /Reds House 1F/i.test(a.label))).toBe(true);
    expect(acts.some((a) => /PC/.test(a.label))).toBe(true);
    const d = acts.map((a) => a.distance!);
    expect(d).toEqual([...d].sort((p, q) => p - q));
    expect(acts.every((a) => !/objective|toward|areas\)|\(\d+,\d+\)/i.test(a.label))).toBe(true);
  });

  it('gives every action a different label', () => {
    const labels = listActions(boot('fx-bedroom')).map((a) => a.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('offers the START menu and no steps-to-nowhere extras', () => {
    const ids = listActions(boot('fx-bedroom')).map((a) => a.id);
    expect(ids).toContain('start');
    expect(ids.some((id) => /grass|explore/.test(id))).toBe(false);
  });

  it('taking the stairs changes the map', () => {
    const ctx = boot('fx-bedroom');
    const id = listActions(ctx).find((a) => a.id.startsWith('warp:'))!.id;
    expect(runAction(ctx, id).status).toBe('done');
    expect(ctx.gs.mapName).toBe('REDS_HOUSE_1F');
  });

  it('using the PC ends in a prompt', () => {
    const ctx = boot('fx-bedroom');
    const id = listActions(ctx).find((a) => /PC/.test(a.label))!.id;
    expect(runAction(ctx, id).status).toBe('prompt');
    expect(ctx.gs.screen().hasTextBox).toBe(true);
  });

  it('opening the menu ends in a prompt listing its entries', () => {
    const ctx = boot('fx-bedroom');
    expect(runAction(ctx, 'start').status).toBe('prompt');
    expect(listActions(ctx).map((a) => a.id)).toEqual(expect.arrayContaining(['menu:SAVE', 'menu:EXIT']));
  });

  it('tileAction maps a click on a thing to its action and bare floor to a tile walk', () => {
    const ctx = boot('fx-bedroom');
    const pc = listActions(ctx).find((a) => /PC/.test(a.label))!;
    expect(tileAction(ctx, pc.at!.x - ctx.gs.x + 4, pc.at!.y - ctx.gs.y + 4)).toBe(pc.id);
    expect(tileAction(ctx, 4, 4)).toBe(`tile:${ctx.gs.x},${ctx.gs.y}`);
  });

  it('walks to a clicked floor tile', () => {
    const ctx = boot('fx-bedroom');
    const stairs = listActions(ctx).find((a) => a.id.startsWith('warp:'))!;
    // a floor tile next to the player that is not the stairs
    const target = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: ctx.gs.x + dx, y: ctx.gs.y + dy }))
      .find((t) => !(t.x === stairs.at!.x && t.y === stairs.at!.y) && runAction(boot('fx-bedroom'), `tile:${t.x},${t.y}`).status === 'done')!;
    expect(target).toBeTruthy();
    expect(runAction(ctx, `tile:${target.x},${target.y}`).status).toBe('done');
    expect([ctx.gs.x, ctx.gs.y]).toEqual([target.x, target.y]);
  });

  it('an unreachable tile fails cleanly', () => {
    const ctx = boot('fx-bedroom'); const f0 = ctx.emu.frames;
    expect(runAction(ctx, 'tile:200,200')).toEqual({ status: 'failed', message: "Can't get there." });
    expect(ctx.emu.frames).toBe(f0);
  });

  it('tileAction is null when the player is not free to walk', () => {
    expect(tileAction(boot('fx-menu'), 4, 4)).toBeNull();
  });
});

import { GameClient } from '../../src/server/game.js';
import { ROM_PATH } from '../helpers/rom.js';

describe.skipIf(!hasFixture('fx-bedroom'))('click-to-go through the game thread', () => {
  it('resolves a click on the player’s own tile and runs it', async () => {
    const g = await GameClient.start({ romPath: ROM_PATH, resume: 'fixtures/fx-bedroom', autosave: false });
    const id = await g.tileAction(4, 4);
    expect(id).toBe(`tile:${g.state.x},${g.state.y}`);
    expect((await g.run(id!)).status).toBe('done');
    await g.shutdown();
  });
});
