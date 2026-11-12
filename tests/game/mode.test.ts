import { describe, it, expect } from 'vitest';
import { hasRom, boot } from '../helpers/rom.js';
import { detectMode } from '../../src/game/mode.js';

describe.skipIf(!hasRom)('detectMode', () => {
  it('is boot on a fresh emulator, then leaves boot after the title screen', () => {
    const ctx = boot();
    expect(detectMode(ctx)).toBe('boot');
    for (let i = 0; i < 40 && detectMode(ctx) === 'boot'; i++) ctx.emu.press('START', 6, 60);
    expect(['dialog', 'busy']).toContain(detectMode(ctx));
  });
});
