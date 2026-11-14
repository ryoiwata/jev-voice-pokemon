// Turning a streaming answer into sentences that can be spoken one by one.

/** Answer text cleaned for speaking: no game arrows, markdown, or `say` commands ("[[volm 0]]"). */
export function speechText(s: string): string {
  return s
    .replace(/[▼*_`#]/g, '')
    // every bracket goes, so no "[[" can be left or rebuilt for `say` to obey
    .replace(/[[\]]/g, ' ')
    .replace(/\bLv\.? ?(\d)/g, 'level $1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words that end in a full stop without ending the sentence. */
const ABBREV = /(?:^|\s)(?:Mt|Mr|Mrs|Dr|St|Prof|Lv|vs|e\.g|i\.e)$/i;
/** The end of a sentence: . ! or ? (repeats allowed), then a space. Decimals never match, as no space follows. */
const END = /[.!?]+(?=\s)/g;

/** Every complete sentence in `text` from `from` on, and where the unfinished rest starts. */
function cut(text: string, from: number): { sentences: string[]; next: number } {
  const sentences: string[] = [];
  let start = from;
  END.lastIndex = from;
  for (let m: RegExpExecArray | null; (m = END.exec(text)); ) {
    const end = m.index + m[0].length;
    if (m[0] === '.' && ABBREV.test(text.slice(start, m.index))) continue;
    const s = speechText(text.slice(start, end));
    if (s) sentences.push(s);
    start = end;
  }
  return { sentences, next: start };
}

/**
 * Hands out the sentences of an answer as it streams in, each once, as soon as it is complete.
 * `finish` gives what is left once the answer is final.
 */
export class SentenceCutter {
  /** the text handed out so far (as it streamed) */
  private done = '';

  /** Call with the whole answer so far. */
  push(soFar: string): string[] {
    if (!soFar.startsWith(this.done)) return [];
    const { sentences, next } = cut(soFar, this.done.length);
    this.done = soFar.slice(0, next);
    return sentences;
  }

  /** The rest of the final answer. If it is not what streamed (a refusal, a failure), all of it, with `replaced`. */
  finish(final: string): { sentences: string[]; replaced: boolean } {
    // the final answer is trimmed, so what streamed is compared without its leading blank space
    const done = this.done.trimStart();
    const replaced = done.trim() !== '' && !final.startsWith(done);
    const from = replaced ? 0 : done.length;
    const { sentences, next } = cut(final, from);
    const tail = speechText(final.slice(next));
    this.done = final;
    return { sentences: tail ? [...sentences, tail] : sentences, replaced };
  }
}
