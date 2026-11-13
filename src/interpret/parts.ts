// One sentence can ask for several things in a row: "get around the boy and continue east".
// Each part is then carried out as a command of its own, in order.

/** Words a command starts with. "and" only separates commands when one of these follows it ("mom and dad" stays whole). */
const VERBS = 'go|walk|talk|keep|continue|carry|read|enter|leave|use|open|step|head|move|get|pick|take|press|save|check|throw|switch|run|examine|look|turn|come|exit|climb|follow|stand|face|grab|heal|buy|speak|close|choose|select|catch|fight|attack|surf|cut|fly|jump|return|wait';
const BREAK = new RegExp(`\\s*(?:[,;]?\\s+(?:and\\s+)?then\\s+|[.;!]\\s+|,?\\s+and\\s+(?=(?:${VERBS})\\b)|,\\s+(?=(?:${VERBS})\\b))`, 'i');
export const MAX_PARTS = 4;

/** The commands in a sentence, in order. A sentence that is one command comes back as one part. */
export function splitParts(said: string): string[] {
  const clean = (s: string) => s.trim().replace(/[.!?,;]+$/, '').trim();
  const whole = clean(said);
  if (!whole) return [];
  if (/\?\s*$/.test(said.trim())) return [whole]; // a question is never a list of commands
  const parts: string[] = [];
  let rest = whole;
  while (parts.length < MAX_PARTS - 1) {
    const m = rest.match(BREAK);
    if (!m || m.index === undefined) break;
    const head = clean(rest.slice(0, m.index)), tail = rest.slice(m.index + m[0].length);
    if (!head || !clean(tail)) break;
    parts.push(head); rest = tail;
  }
  parts.push(clean(rest));
  return parts;
}
