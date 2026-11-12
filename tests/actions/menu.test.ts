import { describe, it, expect } from 'vitest';
import { listActions, runAction } from '../../src/actions/index.js';
import { GameClient } from '../../src/server/game.js';
import { Slot } from '../../src/worker/control.js';
import { hasFixture, boot, ROM_PATH } from '../helpers/rom.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasFixture('fx-menu'))('menu actions', () => {
  it('lists the on-screen options and a way back', () => {
    const acts = listActions(boot('fx-menu'));
    const labels = acts.filter((a) => a.kind === 'menu').map((a) => a.label);
    expect(labels).toContain('NEW NAME');
    expect(labels.length).toBeGreaterThanOrEqual(4);
    expect(acts.some((a) => a.kind === 'text')).toBe(false);
  });

  it('choosing NEW NAME opens the naming screen and returns prompt; name types it', () => {
    const ctx = boot('fx-menu');
    expect(runAction(ctx, 'menu:NEW NAME').status).toBe('prompt');
    expect(listActions(ctx).map((a) => a.id)).toContain('name');
    expect(runAction(ctx, 'name', { text: 'Ryo' }).status).not.toBe('failed');
    for (let i = 0; i < 600 && ctx.gs.playerName !== 'RYO'; i++) ctx.emu.frame();
    expect(ctx.gs.playerName).toBe('RYO');
  });

  it('name refuses text with no letters in it', () => {
    const ctx = boot('fx-menu');
    runAction(ctx, 'menu:NEW NAME');
    expect(runAction(ctx, 'name', { text: '123 !!' }).status).toBe('failed');
    expect(listActions(ctx).map((a) => a.id)).toContain('name');
  });

  it('choosing a preset name moves the game on', () => {
    const ctx = boot('fx-menu');
    const preset = listActions(ctx).filter((a) => a.kind === 'menu' && a.label !== 'NEW NAME' && a.id !== 'menu:back')[0];
    runAction(ctx, preset.id);
    for (let i = 0; i < 600 && ctx.gs.playerName !== preset.label; i++) ctx.emu.frame();
    expect(ctx.gs.playerName).toBe(preset.label);
  });

  it('a stale menu id fails without pressing anything', () => {
    const ctx = boot('fx-bedroom'); const f0 = ctx.emu.frames;
    expect(runAction(ctx, 'menu:YES').status).toBe('failed');
    expect(ctx.emu.frames).toBe(f0);
  });
});

describe.skipIf(!hasFixture('fx-dialog'))('dialogue', () => {
  it('offers Continue while text is waiting, and it advances the dialogue', () => {
    const ctx = boot('fx-dialog');
    expect(listActions(ctx).map((a) => a.id)).toContain('text:next');
    const before = ctx.gs.screen().dialog;
    runAction(ctx, 'text:next');
    expect(ctx.gs.screen().dialog).not.toBe(before);
  });

  it('auto-advance moves plain dialogue on by itself', async () => {
    const g = await GameClient.start({ romPath: ROM_PATH, resume: 'fixtures/fx-dialog', autosave: false });
    g.ctl.set(Slot.SPEED_X100, 800); g.ctl.set(Slot.ADVANCE_PACE_MS, 200);
    await sleep(300);
    const before = g.state.dialog;
    await sleep(3000);
    expect(g.state.dialog).not.toBe(before);
    await g.shutdown();
  });

  it('with auto-advance off, the dialogue waits for the player', async () => {
    const g = await GameClient.start({ romPath: ROM_PATH, resume: 'fixtures/fx-dialog', autosave: false });
    g.ctl.set(Slot.AUTO_ADVANCE, 0); g.ctl.set(Slot.SPEED_X100, 800); g.ctl.set(Slot.ADVANCE_PACE_MS, 200);
    await sleep(300);
    const before = g.state.dialog;
    await sleep(2000);
    expect(g.state.dialog).toBe(before);
    await g.shutdown();
  });
});
