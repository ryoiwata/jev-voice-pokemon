// Compares wordings of the "does any action fit" question, each a separate question over the same state.
import '../../src/server/env.js';
import { GameClient } from '../../src/server/game.js';
import { GatewayJev } from '../../src/jev/gateway.js';
import { facts } from '../../src/interpret/interpreter.js';
import { CASES } from './cases.js';

const W: Record<string, any> = {
  current: { type: 'noul', instructions: 'Does one of the actions in `canDoNow` do what the player asked for in `said`?', criteria: {
    true: 'One action in `canDoNow` does what the player asked for, even if the player used other words for it, such as "the man" for a person the game calls a Fisher.',
    false: 'No action in `canDoNow` does it, such as when the player asks to fly to a town and no listed action flies there.' } },
  plain: { type: 'noul', instructions: 'Can what the player asked for in `said` be done with one of the actions in `canDoNow`?', criteria: {
    true: 'An action in `canDoNow` does it, whatever words the player used for it.', false: 'None of the actions in `canDoNow` does it.' } },
  bare: { type: 'noul', instructions: 'Is what the player asked for in `said` one of the actions in `canDoNow`?' },
  request: { type: 'noul', instructions: 'Can the game do what the player asks for in `said` right now, using one of the actions in `canDoNow`?', criteria: {
    true: 'One of the actions in `canDoNow` does what the player asks, even when the player names it differently, such as "heal my Pokémon" for using a potion or "skip" for continuing the text.',
    false: 'The player asks for something none of the actions in `canDoNow` does, such as flying to a town when no listed action flies there, or using an item that is not listed.' } },
};

const jev = new GatewayJev();
const game = await GameClient.start({ romPath: process.env.ROM_PATH ?? 'roms/red.gb', autosave: false });
const loaded: Record<string, any> = {};
for (const s of new Set(CASES.map((c) => c.state))) { await game.load(s); await new Promise((r) => setTimeout(r, 300)); loaded[s] = { actions: game.actions.filter((a) => a.kind !== 'press'), state: game.state }; }
const reps = +(process.argv[2] ?? 2);
const score: Record<string, { tp: number; tb: number; tn: number; fp: number; fb: number; fn: number }> = {};
const misses: string[] = [];
for (const list of ['hints', 'labels']) {
  const jobs = CASES.filter((c) => !('kind' in c.expect && c.expect.kind === 'question'));
  const queue = Array.from({ length: reps }, () => jobs).flat();
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const g = loaded[c.state];
      const canDoNow = g.actions.map((a: any) => (list === 'hints' ? a.hint ?? a.label : a.label));
      const res = await jev.evaluate({ state: { said: c.said, canDoNow, ...facts(g.state) }, questions: W });
      const truth = !('kind' in c.expect);
      for (const w of Object.keys(W)) {
        const v = (res.answers[w] as any).noul as number, k = `${list}/${w}`;
        const s = score[k] ??= { tp: 0, tb: 0, tn: 0, fp: 0, fb: 0, fn: 0 };
        if (truth) v >= 0.7 ? s.tp++ : v > 0.3 ? s.tb++ : s.tn++; else v >= 0.7 ? s.fp++ : v > 0.3 ? s.fb++ : s.fn++;
        if (w === 'request' && (truth ? v < 0.7 : v > 0.3)) misses.push(`${k} "${c.said}" ${v.toFixed(2)} (fits: ${truth})`);
      }
    }
  }));
}
console.log('wording            fits: yes  unsure  no(WRONG)   doesn\'t fit: no  unsure  yes(WRONG)');
for (const [k, s] of Object.entries(score)) console.log(`${k.padEnd(18)} ${String(s.tp).padStart(10)} ${String(s.tb).padStart(7)} ${String(s.tn).padStart(10)}   ${String(s.fn).padStart(15)} ${String(s.fb).padStart(7)} ${String(s.fp).padStart(11)}`);
console.log([...new Set(misses)].sort().join('\n'));
process.exit(0);
