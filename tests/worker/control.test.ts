import { describe, it, expect } from 'vitest';
import { Control, Slot, StopError } from '../../src/worker/control.js';
import { hasRom, boot } from '../helpers/rom.js';

describe('Control', () => {
  it('press/release set and clear bits; heldButtons lists them', () => {
    const c = new Control(); c.press('A'); c.press('LEFT');
    expect(c.heldButtons().sort()).toEqual(['A', 'LEFT']);
    c.release('A'); expect(c.heldButtons()).toEqual(['LEFT']);
    c.releaseAll(); expect(c.get(Slot.HELD)).toBe(0);
  });
  it('shares state across instances on the same buffer', () => {
    const a = new Control(); const b = new Control(a.sab);
    a.set(Slot.STOP, 1); expect(b.get(Slot.STOP)).toBe(1);
  });
});

describe.skipIf(!hasRom)('Emulator control hook', () => {
  it('frame() throws StopError only while RUNNING', () => {
    const ctx = boot(); const ctl = new Control(); ctx.emu.attachControl(ctl);
    ctl.set(Slot.STOP, 1); expect(() => ctx.emu.frame()).not.toThrow();
    ctl.set(Slot.RUNNING, 1); expect(() => ctx.emu.frame()).toThrow(StopError);
  });
});
