// Which console buttons to draw as pressed, and the trail of presses for the command strip.
import type { Button } from '../../src/emu/emulator';
import { BUTTONS, maskButtons } from '../../src/server/wire';

/** A press is drawn for at least this long, so a one-frame tap can be seen. */
export const MIN_SHOW_MS = 90;
/** How many presses the trail keeps. */
export const TRAIL_MAX = 12;

export class PressTracker {
  private mask = 0;
  private lastDown = new Map<Button, number>();
  private held = new Set<Button>();
  private presses: Button[] = [];

  /** A picture frame arrived, with the buttons held in the game since the one before. */
  frame(mask: number, now: number): void {
    for (const b of maskButtons(mask)) {
      if (!(this.mask & (1 << BUTTONS.indexOf(b)))) { this.presses.push(b); if (this.presses.length > TRAIL_MAX) this.presses.shift(); }
      this.lastDown.set(b, now);
    }
    this.mask = mask;
  }

  /** The player pressed or released a button on the page or keyboard: drawn at once, whatever frames say. */
  local(button: Button, down: boolean): void {
    if (down) this.held.add(button); else this.held.delete(button);
  }

  /** Buttons to draw as pressed at this time. */
  shown(now: number): Button[] {
    return BUTTONS.filter((b) => {
      if (this.held.has(b) || this.mask & (1 << BUTTONS.indexOf(b))) return true;
      const t = this.lastDown.get(b);
      return t !== undefined && now - t < MIN_SHOW_MS;
    });
  }

  /** Presses the game received since the trail was cleared, oldest first. */
  trail(): Button[] { return this.presses.slice(); }
  clearTrail(): void { this.presses = []; }
}
