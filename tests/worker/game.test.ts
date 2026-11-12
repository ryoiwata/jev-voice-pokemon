import { describe, it, expect } from 'vitest';
import { once } from 'node:events';
import { GameClient } from '../../src/server/game.js';
import { Slot } from '../../src/worker/control.js';
import { hasRom, ROM_PATH } from '../helpers/rom.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasRom)('GameClient', () => {
  it('emits frames and a state snapshot, and saves/loads', async () => {
    const g = await GameClient.start({ romPath: ROM_PATH, autosave: false });
    const frame = await once(g, 'frame');
    expect(frame[0].length).toBe(160 * 144 * 4);
    expect(g.state.mode).toBe('boot');
    await g.save('t-roundtrip'); await g.load('t-roundtrip');
    expect((await g.screenPng()).subarray(1, 4).toString()).toBe('PNG');
    await g.shutdown();
  });

  it('held buttons advance the game while idle', async () => {
    const g = await GameClient.start({ romPath: ROM_PATH, autosave: false });
    g.ctl.set(Slot.SPEED_X100, 800);
    const t0 = Date.now();
    while (g.state.mode === 'boot' && Date.now() - t0 < 15000) { g.ctl.press('START'); await sleep(80); g.ctl.release('START'); await sleep(80); }
    expect(g.state.mode).not.toBe('boot');
    await g.shutdown();
  });
});
