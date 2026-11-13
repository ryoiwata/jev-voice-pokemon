import { describe, it, expect } from 'vitest';
import { once } from 'node:events';
import { GameClient } from '../../src/server/game.js';
import { Slot } from '../../src/worker/control.js';
import { hasRom, ROM_PATH } from '../helpers/rom.js';
import { buttonMask } from '../../src/server/wire.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasRom)('GameClient', () => {
  it('emits frames and a state snapshot, and saves/loads', async () => {
    const g = await GameClient.start({ romPath: ROM_PATH, autosave: false });
    const frame = await once(g, 'frame');
    expect(frame[0].length).toBe(1 + 160 * 144 * 4);
    expect(g.state.mode).toBe('boot');
    await g.save('t-roundtrip'); await g.load('t-roundtrip');
    expect((await g.screenPng()).subarray(1, 4).toString()).toBe('PNG');
    await g.shutdown();
  });

  it('every frame starts with the buttons held since the last one, even at 4× speed', async () => {
    const g = await GameClient.start({ romPath: ROM_PATH, autosave: false });
    const masks: number[] = [];
    g.on('frame', (f: Uint8Array) => { masks.push(f[0]); });
    g.ctl.set(Slot.SPEED_X100, 400); // most emulator frames are never sent
    await g.run('press:A');
    expect(masks.some((m) => m === buttonMask(['A']))).toBe(true);
    await sleep(100);
    masks.length = 0;
    await sleep(200);
    expect(masks.length).toBeGreaterThan(0);
    expect(masks.every((m) => m === 0)).toBe(true); // idle again: nothing held
    g.ctl.press('LEFT');
    await sleep(150);
    expect(masks.some((m) => m === buttonMask(['LEFT']))).toBe(true); // the player's own held button shows too
    g.ctl.release('LEFT');
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
