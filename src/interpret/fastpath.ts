import type { InputMode } from '../server/wire.js';

/** A command recognised without any AI. */
export type Fast =
  | { kind: 'stop' }
  | { kind: 'set'; key: 'mode'; value: InputMode }
  | { kind: 'set'; key: 'autoAdvance'; value: boolean }
  | { kind: 'save' } | { kind: 'load' }
  | { kind: 'run'; id: string; arg?: unknown }
  | { kind: 'pick'; index: number };

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const num = (t: string) => (/^\d+$/.test(t) ? +t : NUMBERS.indexOf(t));
const ORDINAL: Record<string, number> = { one: 0, '1': 0, first: 0, two: 1, '2': 1, second: 1, three: 2, '3': 2, third: 2 };

/**
 * The small fixed grammar: stop, app controls, single buttons, directions with a count, "next",
 * naming, and number answers to a pending "did you mean". Anything else is null and goes to the interpreter.
 * `has` says whether an action id is on offer right now; `pending` whether a "did you mean" is waiting.
 */
export function fastPath(text: string, has: (id: string) => boolean, pending: boolean): Fast | null {
  const raw = text.trim().replace(/[.!?,]+$/, '').trim();
  const t = raw.toLowerCase().replace(/\s+/g, ' ');
  if (!t) return null;
  let m: RegExpMatchArray | null;

  if (/^(stop|halt|cancel)$/.test(t)) return { kind: 'stop' };
  if ((m = t.match(/^(voice|text|controls|agent) mode$/))) return { kind: 'set', key: 'mode', value: m[1] as InputMode };
  if ((m = t.match(/^auto[- ]?advance (on|off)$/))) return { kind: 'set', key: 'autoAdvance', value: m[1] === 'on' };
  if (t === 'save') return { kind: 'save' };
  if (t === 'load') return { kind: 'load' };

  if (pending && (m = t.match(/^(?:the |number )?(one|two|three|1|2|3|first|second|third)(?: one)?$/))) return { kind: 'pick', index: ORDINAL[m[1]] };

  if ((m = t.match(/^(?:press |push |hit )?(a|b|start|select)(?: button)?$/))) return { kind: 'run', id: `press:${m[1].toUpperCase()}` };

  if ((m = t.match(/^(?:go |walk |move |step )?(up|down|left|right)(?: (\d+|[a-z]+))?(?: steps?| times?)?$/))) {
    const dir = m[1];
    const n = m[2] === undefined ? 1 : num(m[2]);
    if (n >= 1 && n <= 20) return has(`steps:${dir}`) ? { kind: 'run', id: `steps:${dir}`, arg: n } : n === 1 ? { kind: 'run', id: `press:${dir.toUpperCase()}` } : null;
    return null;
  }

  if (/^(next|continue|okay|ok)$/.test(t)) return has('text:next') ? { kind: 'run', id: 'text:next' } : null;

  if (has('name') && (m = raw.match(/^(?:name|call)\s+(?:(?:it|him|her|them|me)\s+)?(.+)$/i))) return { kind: 'run', id: 'name', arg: { text: m[1].trim() } };

  return null;
}
