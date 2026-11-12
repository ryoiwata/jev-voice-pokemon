import type { Ctx } from './types.js';
import { detectMode } from '../game/mode.js';
import { isNamingScreen } from './nav.js';

/**
 * Decides when plain on-screen text should be continued for the player: it has been showing,
 * unchanged, for the reading time, and the game is not asking for a choice.
 */
export class AutoAdvance {
  private text = '';
  private since = 0;

  reset() { this.text = ''; }

  /** True when A should be tapped now. Call it regularly with the current time. */
  due(ctx: Ctx, now: number, paceMs: number): boolean {
    const s = ctx.gs.screen();
    const mode = detectMode(ctx);
    // (battles are full of text too: "Critical hit!", "Enemy SQUIRTLE fainted!")
    if (s.cursor || (mode !== 'dialog' && mode !== 'battle') || isNamingScreen(ctx)) { this.text = ''; this.since = now; return false; }
    // the ▼ prompt blinks, so the text is compared without it and a blink doesn't restart the clock.
    // A full-screen page with no text box (a Pokédex entry) is compared as a whole.
    const text = (s.hasTextBox ? s.dialog : s.rows.join('')).replace(/▼/g, '').trim();
    if (!text) { this.text = ''; this.since = now; return false; }
    if (text !== this.text) { this.text = text; this.since = now; return false; }
    // (not every finished text box shows the ▼ prompt, so unchanged text is the signal)
    if (now - this.since < paceMs) return false;
    this.text = ''; this.since = now;
    return true;
  }
}
