import { describe, it, expect } from 'vitest';
import { Interpreter } from '../../src/interpret/interpreter.js';
import { Jev } from '../../src/jev/client.js';
import { StandinJev } from '../../src/jev/standin.js';
import type { JevBackend, JevRequest, JevResult } from '../../src/jev/types.js';
import type { Action } from '../../src/actions/types.js';
import type { GameSnapshot } from '../../src/game/snapshot.js';

const A = (id: string, label: string, extra: Partial<Action> = {}) => ({ id, kind: 'interact', label, ...extra }) as Action;
const S: GameSnapshot = {
  mode: 'overworld', map: 'VIRIDIAN_CITY', x: 1, y: 1, facing: 'down', money: 0, badges: 0, pokedex: { seen: 0, owned: 0 }, playTime: '0:00',
  party: [], bag: [], battle: null, dialog: '', running: null,
};
const acts = [
  A('npc:1', 'Pick up the item ball'), A('npc:2', 'Talk to Youngster to the north'), A('npc:3', 'Talk to Youngster to the east'),
  A('npc:4', 'Examine the Poké Ball'), A('ball:ULTRA BALL', 'Throw ULTRA BALL'), A('ball:MASTER BALL', 'Throw MASTER BALL', { costly: true }),
  A('run', 'Run away'), A('start', 'Open the menu'), A('press:A', 'Press A', { kind: 'press' }),
];
const standin = () => new Interpreter(new Jev({ backend: new StandinJev(), logFile: null }), new StandinJev());

describe('Interpreter on the stand-in', () => {
  it('acts on a command that names one thing', async () => {
    expect(await standin().interpret('catch with ultra ball', acts, S)).toMatchObject({ kind: 'act', action: { id: 'ball:ULTRA BALL' } });
    expect(await standin().interpret('walk to the poke ball', acts, S)).toMatchObject({ kind: 'act', action: { id: 'npc:4' } });
    expect(await standin().interpret('Run.', acts, S)).toMatchObject({ kind: 'act', action: { id: 'run' } });
    expect(await standin().interpret('open the menu', acts, S)).toMatchObject({ kind: 'act', action: { id: 'start' } });
  });
  it('tolerates a small misspelling', async () => {
    expect(await standin().interpret('talk to the yungster to the north', acts, S)).toMatchObject({ kind: 'act', action: { id: 'npc:2' } });
  });
  it('asks when two things fit equally, offering both', async () => {
    const r = await standin().interpret('talk to the youngster', acts, S);
    expect(r.kind).toBe('clarify');
    if (r.kind === 'clarify') expect(r.options.map((o) => o.id).slice(0, 2).sort()).toEqual(['npc:2', 'npc:3']);
  });
  it('uses a direction in the command to tell two things apart', async () => {
    expect(await standin().interpret('talk to the youngster to the east', acts, S)).toMatchObject({ kind: 'act', action: { id: 'npc:3' } });
  });
  it('never lets a costly action win a near-tie', async () => {
    expect((await standin().interpret('throw ball', acts, S)).kind).toBe('clarify');
  });
  it('still runs a costly action that is named exactly', async () => {
    expect(await standin().interpret('throw master ball', acts, S)).toMatchObject({ kind: 'act', action: { id: 'ball:MASTER BALL' } });
  });
  it('sees a question as a question', async () => {
    expect((await standin().interpret("what's good against rock types?", acts, S)).kind).toBe('question');
    expect((await standin().interpret('how do I get to Cerulean', acts, S)).kind).toBe('question');
  });
  it('says so when nothing on offer fits', async () => {
    expect((await standin().interpret('fly to cerulean city', acts, S)).kind).toBe('impossible');
  });
  it('does nothing with empty text and never acts on a wall of text', async () => {
    expect(await standin().interpret('   ', acts, S)).toMatchObject({ kind: 'nothing', reason: 'empty' });
    expect((await standin().interpret('x'.repeat(5000), acts, S)).kind).not.toBe('act');
  });
  it('reports busy when only raw buttons are on offer', async () => {
    expect(await standin().interpret('use ember', [A('press:A', 'Press A', { kind: 'press' }), A('wait', 'Wait a moment', { kind: 'press' })], S)).toMatchObject({ kind: 'nothing', reason: 'busy' });
  });
  it('never offers raw buttons or steps as guesses', async () => {
    const r = await standin().interpret('press', [...acts, A('steps:left', 'Step left', { kind: 'steps' })], S);
    if (r.kind === 'clarify') expect(r.options.every((o) => o.kind !== 'press' && o.kind !== 'steps')).toBe(true);
    expect(r.kind).not.toBe('act');
  });
});

class Spy implements JevBackend {
  name = 'spy'; last: JevRequest | null = null;
  constructor(private inner: JevBackend = new StandinJev()) {}
  evaluate(req: JevRequest): Promise<JevResult> { this.last = req; return this.inner.evaluate(req); }
}
const throwing: JevBackend = { name: 'broken', evaluate: () => Promise.reject(new Error('gateway down')) };
const hanging: JevBackend = { name: 'slow', evaluate: () => new Promise(() => {}) };

describe('Interpreter and the Jev service', () => {
  it('falls back to the stand-in when Jev fails, and says so', async () => {
    const I = new Interpreter(new Jev({ backend: throwing, logFile: null, retries: 0 }), new StandinJev());
    expect(await I.interpret('catch with ultra ball', acts, S)).toMatchObject({ kind: 'act', fellBack: true, backend: 'standin' });
  });
  it('falls back when Jev does not answer in time', async () => {
    const I = new Interpreter(new Jev({ backend: hanging, logFile: null, retries: 0 }), new StandinJev(), { timeoutMs: 50 });
    expect(await I.interpret('catch with ultra ball', acts, S)).toMatchObject({ kind: 'act', fellBack: true });
  });
  it('sends at most 255 options, keeping the nearest', async () => {
    const many = Array.from({ length: 400 }, (_, i) => A(`sign:${i},0`, `Read sign ${i}`, { distance: i }));
    const spy = new Spy();
    await new Interpreter(new Jev({ backend: spy, logFile: null }), new StandinJev()).interpret('read sign 3', many, S);
    const criteria = (spy.last!.questions.intent as { criteria: Record<string, string> }).criteria;
    expect(Object.keys(criteria).length).toBeLessThanOrEqual(255);
    expect(criteria['sign:3,0']).toBeDefined();
    expect(criteria['sign:399,0']).toBeUndefined();
    expect(criteria.__question).toBeDefined();
  });
  it('tells Jev what was said and where the player is, and nothing about strategy', async () => {
    const spy = new Spy();
    await new Interpreter(new Jev({ backend: spy, logFile: null }), new StandinJev()).interpret('open the menu', acts, S);
    expect(spy.last!.state).toMatchObject({ said: 'open the menu', place: 'VIRIDIAN_CITY', situation: 'overworld' });
  });
  it('respects thresholds passed in', async () => {
    const strict = new Interpreter(new Jev({ backend: new StandinJev(), logFile: null }), new StandinJev(), { minP: 0.99, minMargin: 0.9 });
    expect((await strict.interpret('catch with ultra ball', acts, S)).kind).toBe('clarify');
  });
});

describe('stand-in guards', () => {
  it('does not act when only the verb matches', async () => {
    expect((await standin().interpret('use potion', acts, S)).kind).toBe('impossible');
    expect((await standin().interpret('talk', acts, S)).kind).toBe('impossible');
  });
});
