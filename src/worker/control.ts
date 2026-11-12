import type { Button } from '../emu/emulator.js';

/** Slots of the shared control block (an Int32Array both threads see). */
export const Slot = { STOP: 0, HELD: 1, AUTO_ADVANCE: 2, ADVANCE_PACE_MS: 3, SPEED_X100: 4, RUNNING: 5 } as const;
export type Slot = (typeof Slot)[keyof typeof Slot];

export const BUTTON_BIT: Record<Button, number> = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128 };
const BUTTONS = Object.keys(BUTTON_BIT) as Button[];

/** Thrown out of Emulator.frame() when the player says stop while an action is running. */
export class StopError extends Error {
  constructor() { super('stopped'); this.name = 'StopError'; }
}

/**
 * Signals that must get through while the game thread is busy inside a blocking action:
 * stop, the buttons a human is holding, and a few live settings.
 */
export class Control {
  readonly sab: SharedArrayBuffer;
  private a: Int32Array;

  constructor(sab?: SharedArrayBuffer) {
    this.sab = sab ?? new SharedArrayBuffer(8 * 4);
    this.a = new Int32Array(this.sab);
    if (!sab) { this.set(Slot.AUTO_ADVANCE, 1); this.set(Slot.ADVANCE_PACE_MS, 1500); this.set(Slot.SPEED_X100, 100); }
  }

  get(s: Slot): number { return Atomics.load(this.a, s); }
  set(s: Slot, v: number): void { Atomics.store(this.a, s, v); }
  press(b: Button): void { Atomics.or(this.a, Slot.HELD, BUTTON_BIT[b]); }
  release(b: Button): void { Atomics.and(this.a, Slot.HELD, ~BUTTON_BIT[b]); }
  releaseAll(): void { this.set(Slot.HELD, 0); }
  heldButtons(): Button[] {
    const m = this.get(Slot.HELD);
    return BUTTONS.filter((b) => m & BUTTON_BIT[b]);
  }
}
