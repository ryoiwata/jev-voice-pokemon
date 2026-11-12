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
