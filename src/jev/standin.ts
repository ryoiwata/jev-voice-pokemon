import type { JevBackend, JevRequest, JevResult, JevAnswer } from './types.js';

/**
 * A local stand-in for Jev: free, instant, no key. It matches the words the player said against the
 * labels of the options. It handles commands that name the thing ("walk to the poke ball", "use ember")
 * and nothing cleverer. The real Jev replaces it 1:1 once TYPESAFE_API_KEY is set.
 */

const DROP = new Set(['the', 'a', 'an', 'to', 'with', 'my', 'please', 'at', 'on', 'of', 'in', 'and', 'this', 'that', 'away', 'up', 'now', 'can', 'you', 'i', 'want']);
/** verbs say less about which thing is meant than the thing's own name */
const VERBS = new Set(['walk', 'go', 'move', 'talk', 'speak', 'use', 'examine', 'enter', 'read', 'pick', 'take', 'grab', 'get', 'throw', 'catch', 'open', 'choose', 'select', 'switch', 'look', 'check', 'push', 'press', 'do']);
const WHERE = new Set(['north', 'south', 'east', 'west', 'nearest', 'second', 'third', 'fourth', 'fifth', 'sixth', 'here', 'right', 'number']);
const QUESTION = /\?\s*$|^(what|whats|why|how|who|where|when|which|is|are|does|do|can|could|should|would|will)\b/;

export function tokens(text: string): string[] {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/poke\s+(ball|mon|dex|mart|center)/g, 'poke$1')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .flatMap((t) => t.split(/(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/))
    .filter((t) => t && !DROP.has(t));
}

function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  // one edit apart
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** How much of an option's label the player's words cover, 0 to 1. */
export function score(said: string[], label: string): number {
  const saidWhere = said.some((t) => WHERE.has(t));
  let total = 0, hit = 0, named = false;
  for (const t of tokens(label)) {
    if (WHERE.has(t) && !saidWhere) continue; // "to the north" on a label only counts when the player gave a direction
    const verb = VERBS.has(t), w = verb ? 0.5 : 1;
    total += w;
    if (said.some((s) => near(s, t))) { hit += w; if (!verb) named = true; }
  }
  // sharing only a verb ("use …") says nothing about which thing was meant
  return total && named ? hit / total : 0;
}

export class StandinJev implements JevBackend {
  name = 'standin';

  async evaluate(req: JevRequest): Promise<JevResult> {
    const said = typeof (req.state as any)?.said === 'string' ? String((req.state as any).said) : '';
    const words = tokens(said);
    const answers: Record<string, JevAnswer> = {};
    for (const [qid, q] of Object.entries(req.questions)) {
      if (q.type === 'boolean') { answers[qid] = { type: 'boolean', probability: 0.5 }; continue; }
      if (q.type === 'score') { answers[qid] = { type: 'score', score: 0 }; continue; }
      const raw: Record<string, number> = {};
      for (const [key, label] of Object.entries(q.criteria)) {
        if (key === '__question') raw[key] = QUESTION.test(said.trim().toLowerCase().replace(/[’']/g, '')) ? 1 : 0;
        else if (key === '__impossible') raw[key] = 0.45;
        else raw[key] = score(words, typeof label === 'string' ? label : key);
      }
      // a sharp curve: a full match should stand well clear of partial ones
      const sum = Object.values(raw).reduce((a, s) => a + s ** 6, 0) || 1;
      const probabilities: Record<string, number> = {};
      for (const [k, s] of Object.entries(raw)) probabilities[k] = s ** 6 / sum;
      const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      answers[qid] = { type: 'choice', choice, probabilities };
    }
    return { answers, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
