import type { Button } from '../../src/emu/emulator.js';

export type Keymap = Record<string, Button>;
export const DEFAULT_KEYMAP: Keymap = {
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', z: 'A', x: 'B', Enter: 'START', Shift: 'SELECT',
};

/** Which Game Boy button a key press means, or null. Letters match in either case. */
export function buttonFor(e: { key: string }, map: Keymap): Button | null {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return map[k] ?? null;
}

/**
 * Whether a key press at this target is for the game. Not while typing, and not while a control on the
 * page has the focus: there Enter must press that control, not START.
 */
export function keysPlayGame(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return !target.closest('input, textarea, select, button, a[href], [role="radio"], [role="button"], [contenteditable="true"]');
}
