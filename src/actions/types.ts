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

export type ActionKind = 'go' | 'door' | 'interact' | 'field' | 'item' | 'move' | 'switch' | 'run' | 'menu' | 'text' | 'name' | 'press' | 'steps' | 'tile';

/** One thing the player could do right now. */
export interface Action {
  id: string; kind: ActionKind; label: string;
  /** hard to undo: needs a closer match before it runs unasked */
  costly?: boolean;
  /** map tile this action is about */
  at?: { x: number; y: number };
  /** steps to walk before it happens */
  distance?: number;
}

export type ActionResult =
  | { status: 'done'; message: string }
  | { status: 'prompt'; message: string }
  | { status: 'interrupted'; message: string }
  | { status: 'stopped'; message: string }
  | { status: 'failed'; message: string };
