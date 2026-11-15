/** Words people wrap around a name when they say one: "let's go with LEO as the name", "my name is RYO". */
const FILLER = new Set(`
a an the as is it its be to of for in on and or so then with my me i im we you your his her him them their our this that
lets let us go going use using pick choose take want wanna would like how about make made put set type typing enter spell write
name named names naming called call nickname nicknamed it's he she they should could can will do does did have has just maybe
please ok okay um uh hmm well yeah yes no thanks thank think guess say said try
`.split(/\s+/).filter(Boolean));

/**
 * The words in a sentence that could be the name the player wants typed, in order.
 * Jev can pick "type a name" but cannot write text, so the name itself has to be lifted from what was said.
 */
export function nameWords(said: string): string[] {
  return said.replace(/[’']/g, '').split(/[^A-Za-z]+/).filter((w) => w && !FILLER.has(w.toLowerCase()));
}

/**
 * The candidates Jev picks a name from: every word said (once, as said), a name spelled out letter by letter
 * ("L E O"), and the non-filler words joined when there are several ("big joe"). Jev cannot write a name, so code
 * offers every reading and Jev chooses.
 */
export function nameCandidates(said: string): string[] {
  const words = said.replace(/[’']/g, '').split(/[^A-Za-z]+/).filter(Boolean);
  const out: string[] = [];
  const add = (w: string) => { if (w && !out.some((o) => o.toLowerCase() === w.toLowerCase())) out.push(w); };
  for (const w of words) add(w);
  for (let i = 0; i < words.length;) {
    let j = i;
    while (j < words.length && words[j].length === 1) j++;
    if (j - i >= 2) add(words.slice(i, j).join('').toUpperCase());
    i = j > i ? j : i + 1;
  }
  const kept = nameWords(said).filter((w, i, all) => all.findIndex((o) => o.toLowerCase() === w.toLowerCase()) === i);
  if (kept.length > 1) add(kept.join(''));
  return out.slice(0, 255);
}
