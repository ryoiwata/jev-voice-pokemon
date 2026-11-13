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
/**
 * Whether these words mean "stop". Stop must be heard however it comes out of dictation: "stop it",
 * "please stop", "wait, stop". Any short utterance with the word in it counts, and so does anything
 * that ends with it, because dictation may add "stop" to a command that is still sitting in the box.
 * A long sentence that merely mentions stopping does not. The page uses this too, to send a stop at once.
 */
export function isStop(text: string): boolean {
  const words = text.toLowerCase().replace(/[^a-z' ]/g, ' ').split(' ').filter(Boolean);
  if (!words.length) return false;
  if (words.length === 1 && words[0] === 'cancel') return true;
  const stop = (w: string) => w === 'stop' || w === 'halt';
  return stop(words[words.length - 1]) || (words.length <= 5 && words.some(stop));
}

export function fastPath(text: string, has: (id: string) => boolean, pending: boolean): Fast | null {
  const raw = text.trim().replace(/[.!?,]+$/, '').trim();
  const t = raw.toLowerCase().replace(/\s+/g, ' ');
  if (!t) return null;
  let m: RegExpMatchArray | null;

  // Stop must be heard however it comes out of dictation: "stop it", "please stop", "stop stop", "wait stop".
  // Any short utterance with the word in it counts; a long sentence that merely contains it does not.
  if (isStop(text)) return { kind: 'stop' };
  if ((m = t.match(/^(voice|text) mode$/))) return { kind: 'set', key: 'mode', value: m[1] as InputMode };
  if ((m = t.match(/^auto[- ]?advance (on|off)$/))) return { kind: 'set', key: 'autoAdvance', value: m[1] === 'on' };
  if (t === 'save') return { kind: 'save' };
  if (t === 'load') return { kind: 'load' };

  if (pending && (m = t.match(/^(?:the |number )?(one|two|three|1|2|3|first|second|third)(?: one)?$/))) return { kind: 'pick', index: ORDINAL[m[1]] };

  if ((m = t.match(/^(?:press |push |hit )?(a|b|start|select)(?: button)?$/))) return { kind: 'run', id: `press:${m[1].toUpperCase()}` };

  if (/^(next|continue|okay|ok)$/.test(t) && has('text:next')) return { kind: 'run', id: 'text:next' };

  // Movement in the ways people say it: "right", "move to the right", "walk up three steps", "go north",
  // "take 3 steps left", "move two steps to the left". The count may come before or after the direction.
  // "Forward" is the way the player is facing. "Keep going", "continue" and "until something is in the
  // way" mean as far as it goes.
  const mv = t.replace(/,/g, ' ').replace(/\s+/g, ' ').replace(/^(?:let'?s|please|now|and|then|okay|ok) /, '');
  const N = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|a)';
  const D = '(up|down|left|right|north|south|east|west|straight ahead|straight on|straight|forwards?|ahead|onwards?)';
  const V = '(?:go |walk |move |step |head |take )?';
  const U = '(?: steps?| times?| tiles?| squares?| spaces?)?';
  const TO = '(?:to the |towards? (?:the )?)?';
  const KEEP = '(?:keep (?:on )?(?:going|walking|moving|heading)|continue(?: going| walking| moving| on)?|carry on(?: going| walking)?|go on)';
  const AS_FAR = 20; // the most steps there are: the walk ends when something is in the way
  const which = (word: string | undefined) => (word === undefined || !/^(up|down|left|right|north|south|east|west)$/.test(word)
    ? 'forward' : ({ north: 'up', south: 'down', east: 'right', west: 'left' } as Record<string, string>)[word] ?? word);
  const far = mv.match(new RegExp(`^${KEEP}(?: ${TO}(?:(?:straight|forwards?|ahead|onwards?) )?${D})?(?: until .+)?$`))
    ?? mv.match(new RegExp(`^${V}${TO}${D}(?: all the way)?(?: until .+)$`))
    ?? mv.match(new RegExp(`^${V}${TO}${D} all the way$`))
    ?? mv.match(new RegExp(`^${V}all the way ${TO}${D}$`));
  if (far) {
    const dir = which(far[1]);
    // said during dialogue with no direction, "keep going" means the next line
    if (far[1] === undefined && has('text:next')) return { kind: 'run', id: 'text:next' };
    return has(`steps:${dir}`) ? { kind: 'run', id: `steps:${dir}`, arg: AS_FAR } : null;
  }
  const after = mv.match(new RegExp(`^${V}${TO}${D}(?: ${N})?${U}$`));
  const before = after ? null : mv.match(new RegExp(`^${V}${N}${U} ${TO}${D}$`));
  if (after || before) {
    const dir = which(after ? after[1] : before![2]);
    const count = after ? after[2] : before![1];
    const n = count === undefined || count === 'a' ? 1 : num(count);
    if (n >= 1 && n <= 20) return has(`steps:${dir}`) ? { kind: 'run', id: `steps:${dir}`, arg: n } : n === 1 && dir !== 'forward' ? { kind: 'run', id: `press:${dir.toUpperCase()}` } : null;
    return null;
  }

  if (has('name') && (m = raw.match(/^(?:name|call)\s+(?:(?:it|him|her|them|me)\s+)?(.+)$/i))) return { kind: 'run', id: 'name', arg: { text: m[1].trim() } };

  return null;
}
