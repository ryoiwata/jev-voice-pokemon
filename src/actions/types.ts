import type { Emulator } from '../emu/emulator.js';
import type { Rom } from '../game/rom.js';
import type { GameState } from '../game/state.js';

/** What the navigation helpers remember between actions. No strategy lives here. */
export interface NavMemory {
  /** per map: squares whose step triggered a speech that pushed the player back */
  trapSquares: Record<string, string[]>;
}

export interface Ctx {
  emu: Emulator; rom: Rom; gs: GameState; mem: NavMemory;
  log(kind: string, msg: string): void;
}

export function newMemory(): NavMemory {
  return { trapSquares: {} };
}
