import type { Ctx } from './types.js';
import { detectMode, type Mode } from '../game/mode.js';
import { isNamingScreen } from './nav.js';

/** What auto-advance looks at. */
export interface AdvanceView { mode: Mode; cursor: boolean; naming: boolean; hasTextBox: boolean; dialog: string; rows: string[] }

/**
 * Decides when plain on-screen text should be continued for the player: a text box has been showing,
 * unchanged, for the reading time, and the game is not asking for anything.
 */
export class AutoAdvance {
  text = '';
  since = 0;
  reset() { this.text = ''; }

  /** True when A should be tapped now. Call it regularly with the current time. */
  due(ctx: Ctx, now: number, paceMs: number): boolean {
    const s = ctx.gs.screen();
    return dueFor(this, { mode: detectMode(ctx), cursor: !!s.cursor, naming: isNamingScreen(ctx), hasTextBox: s.hasTextBox, dialog: s.dialog, rows: s.rows }, now, paceMs);
  }
}

export function dueFor(a: AutoAdvance, v: AdvanceView, now: number, paceMs: number): boolean {
  const wait = () => { a.text = ''; a.since = now; return false; };
  // Only dialogue (battles are full of it too: "Critical hit!"). Never while a choice is showing, and never on a
  // full-screen page with no text box (stats, a Pokédex entry, the map): those are the player's to read and close.
  if (v.cursor || v.naming || !v.hasTextBox || (v.mode !== 'dialog' && v.mode !== 'battle')) return wait();
  // A quantity box ("How many?") uses the hollow cursor; pressing A there would answer for the player.
  if (v.rows.some((r) => r.includes('▷'))) return wait();
  // the ▼ prompt blinks, so the text is compared without it and a blink doesn't restart the clock
  const text = v.dialog.replace(/▼/g, '').trim();
  if (!text) return wait();
  if (text !== a.text) { a.text = text; a.since = now; return false; }
  // (not every finished text box shows the ▼ prompt, so unchanged text is the signal)
  if (now - a.since < paceMs) return false;
  a.text = ''; a.since = now;
  return true;
}
