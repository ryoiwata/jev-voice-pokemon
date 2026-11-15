// Live evaluation of how commands are read, against saved game states, on the real Jev.
// Uses TYPESAFE_API_KEY. Only game facts and the commands in cases.ts are sent.
//   npm run eval -- [variant ...] [--repeat N]
// Variants: old (the question design before November 2026, kept in old-interpreter.ts), old+screen, new,
// new+screen, new-reversed (options in reverse order), names. The states are the fixtures from
// scripts/make-fixtures.ts plus fx-forest, a copy of a save in Viridian Forest; cases on a missing state are skipped.
// Results go to logs/jev-eval-<time>.txt and each call to logs/jev-eval.jsonl.
import '../../src/server/env.js';
import fs from 'node:fs';
import { GameClient } from '../../src/server/game.js';
import { Jev } from '../../src/jev/client.js';
import { GatewayJev, typesafeKey } from '../../src/jev/gateway.js';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { StandinJev } from '../../src/jev/standin.js';
import { Interpreter } from '../../src/interpret/interpreter.js';
import { Interpreter as OldInterpreter } from './old-interpreter.js';
import { CASES, NAME_CASES, type Expect } from './cases.js';
import type { Action } from '../../src/actions/types.js';

const args = process.argv.slice(2);
const repeat = args.includes('--repeat') ? +args[args.indexOf('--repeat') + 1] : 1;
const variants = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--repeat');
const ALL = ['old+screen', 'old', 'new', 'new+screen', 'new-reversed', 'names'];
const run = variants.length ? variants : ALL;

// patient retries here: six cases run at once, so rate limits are expected and must not count as answers
const client = new TypeSafeClient({ apiKey: typesafeKey(), logLevel: 'off', retry: { maxRetries: 6, maxRetryAfterMs: 15000 } });
const jev = new Jev({ backend: new GatewayJev({ client }), logFile: 'logs/jev-eval.jsonl', maxPerMinute: 600 });
const th = { timeoutMs: 15000 };
const newI = new Interpreter(jev, new StandinJev(), th);
const oldI = new OldInterpreter(jev as any, new StandinJev(), th);

type Grade = 'right' | 'safe' | 'wrong';
function grade(r: any, e: Expect): Grade {
  const ids = (r.kind === 'clarify' ? r.options.map((o: Action) => o.id) : []) as string[];
  if ('act' in e) return r.kind === 'act' && e.act.includes(r.action.id) ? 'right' : r.kind === 'clarify' && ids.some((i) => e.act.includes(i)) ? 'safe' : 'wrong';
  if ('clarify' in e) return r.kind === 'clarify' && ids.filter((i) => e.clarify.includes(i)).length >= Math.min(2, e.clarify.length) ? 'right' : (r.kind === 'act' && e.clarify.includes(r.action.id)) || r.kind === 'clarify' ? 'safe' : 'wrong';
  if (e.kind === 'impossible') return r.kind === 'impossible' ? 'right' : r.kind === 'clarify' ? 'safe' : 'wrong';
  return r.kind === 'question' ? 'right' : 'wrong';
}
const show = (r: any) => r.kind === 'act' ? `act ${r.action.id} (${r.p.toFixed(2)})` : r.kind === 'clarify' ? `clarify [${r.options.map((o: Action) => o.id).join(', ')}]` : r.kind;

const missing = [...new Set(CASES.map((c) => c.state))].filter((s) => !fs.existsSync(`saves/${s}.state.json`));
if (missing.length) console.log(`Skipping cases on missing states: ${missing.join(', ')}`);
for (let i = CASES.length - 1; i >= 0; i--) if (missing.includes(CASES[i].state)) CASES.splice(i, 1);

const game = await GameClient.start({ romPath: process.env.ROM_PATH ?? 'roms/red.gb', autosave: false });
const states = [...new Set(CASES.map((c) => c.state))];
const loaded: Record<string, { actions: Action[]; state: any; png: Uint8Array }> = {};
for (const s of states) {
  await game.load(s);
  await new Promise((r) => setTimeout(r, 300));
  loaded[s] = { actions: game.actions, state: game.state, png: await game.screenPng() };
}

const report: string[] = [];
const summary: Record<string, Record<Grade, number> & { ms: number; tokens: number; n: number; skipped: number }> = {};
for (const v of run) {
  if (v === 'names') continue;
  const tally = summary[v] = { right: 0, safe: 0, wrong: 0, ms: 0, tokens: 0, n: 0, skipped: 0 };
  for (let k = 0; k < repeat; k++) {
    // all cases of one variant at once, a few at a time
    const queue = [...CASES];
    const worker = async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        const g = loaded[c.state];
        const actions = v === 'new-reversed' ? [...g.actions].reverse() : g.actions;
        const image = v.endsWith('+screen') ? g.png : undefined;
        const t0 = Date.now();
        const r = v.startsWith('old') ? await oldI.interpret(c.said, actions, g.state, { image }) : await newI.interpret(c.said, actions, g.state, { image });
        // a call that failed was answered by the local matcher: it says nothing about Jev
        if (r.fellBack) { tally.skipped++; continue; }
        tally.ms += Date.now() - t0; tally.n++;
        const gr = grade(r, c.expect);
        tally[gr]++;
        if (gr !== 'right') report.push(`  [${v}] ${gr.toUpperCase()}  ${c.state.replace('fixtures/', '')}  "${c.said}"  → ${show(r)}   wanted ${JSON.stringify(c.expect)}`);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }
}

if (run.includes('names')) {
  const tally = summary.names = { right: 0, safe: 0, wrong: 0, ms: 0, tokens: 0, n: 0, skipped: 0 };
  const st = loaded[states[0]].state;
  for (let k = 0; k < repeat; k++) for (const c of NAME_CASES) {
    const r = await newI.readName(c.said, st);
    const got = r.kind === 'name' ? r.text : r.kind === 'question' ? 'question' : null;
    const ok = got === c.expect;
    // asking again for a name that was said is safe; typing a wrong one is not
    const gr: Grade = ok ? 'right' : got === null ? 'safe' : 'wrong';
    tally[gr]++; tally.n++;
    if (!ok) report.push(`  [names] ${gr.toUpperCase()}  "${c.said}" → ${got}   wanted ${c.expect}`);
  }
}

const lines = ['variant        right  safe  wrong  skipped   avg ms (6 at once)'];
for (const [v, t] of Object.entries(summary)) lines.push(`${v.padEnd(14)} ${String(t.right).padStart(5)} ${String(t.safe).padStart(5)} ${String(t.wrong).padStart(6)} ${String(t.skipped).padStart(8)}   ${String(Math.round(t.ms / Math.max(1, t.n))).padStart(6)}`);
const out = [...lines, '', ...report.sort()].join('\n');
console.log(out);
fs.mkdirSync('logs', { recursive: true });
fs.writeFileSync(`logs/jev-eval-${Date.now()}.txt`, out + '\n');
console.log(`\n${jev.calls} calls, ${jev.inputTokens} input tokens (about $${(jev.inputTokens * 0.042 / 1e6).toFixed(4)})`);
process.exit(0);
