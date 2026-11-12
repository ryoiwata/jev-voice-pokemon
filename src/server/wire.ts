// The messages the page and the server exchange. Shared by both sides.
import type { Button } from '../emu/emulator.js';
import type { GameSnapshot } from '../game/snapshot.js';

/** Binary messages: first byte is the tag. */
export const TAG_FRAME = 1; // + 160*144*4 bytes RGBA
export const TAG_AUDIO = 2; // + Int16 LE interleaved stereo
export const AUDIO_RATE = 44100;

export type InputMode = 'voice' | 'text' | 'controls' | 'agent';
export const INPUT_MODES: InputMode[] = ['voice', 'text', 'controls', 'agent'];
export const BUTTONS: Button[] = ['A', 'B', 'START', 'SELECT', 'UP', 'DOWN', 'LEFT', 'RIGHT'];

export type Source = 'human' | 'agent';
export interface LogEntry {
  id: string; at: number; source: Source; heard?: string;
  status: 'running' | 'done' | 'failed' | 'stopped' | 'asking' | 'answer' | 'info';
  text: string; choices?: { id: string; label: string }[];
}

export interface SessionInfo { mode: InputMode; autoAdvance: boolean; advancePaceMs: number; speed: number; jev: 'standin' | 'gateway'; answers: boolean }

export type ServerMsg =
  | { type: 'state'; state: GameSnapshot }
  | ({ type: 'session' } & SessionInfo)
  | { type: 'log'; entry: LogEntry }
  | { type: 'saves'; names: string[] };

export type SetKey = 'mode' | 'autoAdvance' | 'advancePaceMs' | 'speed';
export type ClientMsg =
  | { type: 'down' | 'up' | 'tap'; button: Button }
  | { type: 'stop' }
  | { type: 'save' | 'load'; name: string }
  | { type: 'text'; text: string }
  | { type: 'choose'; logId: string; index: number }
  | { type: 'click'; col: number; row: number }
  | { type: 'set'; key: SetKey; value: unknown };

/** Names for saves: letters, digits, dash and underscore only, so a name can never leave the saves folder. */
export const SAVE_NAME = /^[a-z0-9_-]{1,40}$/i;

const int = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Validates a message from the page. Anything malformed is null. */
export function parseClientMsg(raw: string): ClientMsg | null {
  let m: any;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== 'object') return null;
  switch (m.type) {
    case 'down': case 'up': case 'tap':
      return BUTTONS.includes(m.button) ? { type: m.type, button: m.button } : null;
    case 'stop': return { type: 'stop' };
    case 'save': case 'load':
      return typeof m.name === 'string' && SAVE_NAME.test(m.name) ? { type: m.type, name: m.name } : null;
    case 'text': return typeof m.text === 'string' ? { type: 'text', text: m.text } : null;
    case 'choose': return typeof m.logId === 'string' && int(m.index, 0, 9) ? { type: 'choose', logId: m.logId, index: m.index } : null;
    case 'click': return int(m.col, 0, 9) && int(m.row, 0, 8) ? { type: 'click', col: m.col, row: m.row } : null;
    case 'set':
      if (m.key === 'mode') return INPUT_MODES.includes(m.value) ? { type: 'set', key: 'mode', value: m.value } : null;
      if (m.key === 'autoAdvance') return typeof m.value === 'boolean' ? { type: 'set', key: 'autoAdvance', value: m.value } : null;
      if (m.key === 'advancePaceMs') return int(m.value, 300, 10000) ? { type: 'set', key: 'advancePaceMs', value: m.value } : null;
      if (m.key === 'speed') return [1, 2, 4].includes(m.value) ? { type: 'set', key: 'speed', value: m.value } : null;
      return null;
    default: return null;
  }
}
