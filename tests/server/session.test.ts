import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Session, type GameLike } from '../../src/server/session.js';
import { Interpreter } from '../../src/interpret/interpreter.js';
import { Jev } from '../../src/jev/client.js';
import { StandinJev } from '../../src/jev/standin.js';
import { Control, Slot } from '../../src/worker/control.js';
import type { Action, ActionResult } from '../../src/actions/types.js';
import type { LogEntry } from '../../src/server/wire.js';

const A = (id: string, label: string, extra: Partial<Action> = {}) => ({ id, kind: 'interact', label, ...extra }) as Action;
const WORLD = [
  A('npc:4', 'Examine the Poké Ball', { distance: 6 }), A('npc:2', 'Talk to Youngster to the north'), A('npc:3', 'Talk to Youngster to the east'),
  A('item:POTION', 'Use POTION', { kind: 'item' }), A('steps:left', 'Step left', { kind: 'steps' }), A('press:A', 'Press A', { kind: 'press' }),
];
const PARTY_MENU = [A('menu:PIKACHU', 'PIKACHU', { kind: 'menu' }), A('menu:PIDGEY', 'PIDGEY', { kind: 'menu' }), A('press:A', 'Press A', { kind: 'press' })];

/** A game that records what it was asked to do. `script` decides each action's result. */
class FakeGame implements GameLike {
  ctl = new Control();
  state: any = {
    mode: 'overworld', map: 'VIRIDIAN_CITY', x: 5, y: 5, facing: 'down', dialog: '', money: 0, badges: 0, bag: [], battle: null, running: null,
    party: ['PIKACHU', 'PIDGEY'].map((n, slot) => ({ slot, nickname: n, species: n, level: 5, hp: 10, maxHp: 10, status: 'OK', moves: [] })),
  };
  actions: Action[] = WORLD;
  ran: { id: string; arg?: unknown }[] = [];
  script: (id: string) => ActionResult | Promise<ActionResult> = () => ({ status: 'done', message: 'Done.' });
  private settle: ((r: ActionResult) => void) | null = null;
  busy = false;
  stop = vi.fn(() => { this.settle?.({ status: 'stopped', message: 'Stopped.' }); });
  save = vi.fn(async () => {});
  load = vi.fn(async () => {});
  tileAction = vi.fn(async (_col: number, _row: number) => 'tile:3,3' as string | null);
  async run(id: string, arg?: unknown): Promise<ActionResult> {
    if (this.busy) this.stop(); // like the real game: a new action replaces the one in progress
    this.ran.push({ id, arg });
    this.busy = true;
    try {
      return await Promise.race([Promise.resolve(this.script(id)), new Promise<ActionResult>((r) => { this.settle = r; })]);
    } finally { this.busy = false; }
  }
}
const never = () => new Promise<ActionResult>(() => {});

let game: FakeGame, s: Session, logs: LogEntry[], answerer: { enabled: boolean; answer: import('vitest').Mock<(q: string, st: any, d?: (s: string) => void) => Promise<string>> };
const statuses = () => logs.map((l) => l.status);
const last = () => logs[logs.length - 1];
beforeEach(() => {
  game = new FakeGame();
  answerer = { enabled: true, answer: vi.fn(async () => 'Water beats Rock.') };
  s = new Session({ game, interpreter: new Interpreter(new Jev({ backend: new StandinJev(), logFile: null }), new StandinJev()), answerer, jev: 'standin' });
  logs = [];
  s.on('log', (e: LogEntry) => { const i = logs.findIndex((x) => x.id === e.id); if (i >= 0) logs[i] = { ...e }; else logs.push({ ...e }); });
});

describe('Session: commands', () => {
  it('runs a clear command without asking and logs what it heard and did', async () => {
    const seen: string[] = [];
    s.on('log', (e: LogEntry) => seen.push(e.status));
    const r = await s.handleText('walk to the poke ball', 'human');
    expect(game.ran).toEqual([{ id: 'npc:4', arg: undefined }]);
    expect(r.status).toBe('done');
    expect(seen).toEqual(['running', 'done']);
    expect(last()).toMatchObject({ heard: 'walk to the poke ball', source: 'human', text: expect.stringContaining('Examine the Poké Ball (6 steps)') });
  });

  it('asks on an ambiguous command; "two" runs the second choice', async () => {
    const r = await s.handleText('talk to the youngster', 'human');
    expect(r.status).toBe('asking');
    expect(game.ran).toEqual([]);
    expect(last().status).toBe('asking');
    const second = last().choices![1].id;
    await s.handleText('two', 'human');
    expect(game.ran.map((x) => x.id)).toEqual([second]);
  });

  it('a clicked choice runs it, and a stale choice does nothing', async () => {
    await s.handleText('talk to the youngster', 'human');
    const entry = last();
    await s.choose(entry.id, 0, 'human');
    expect(game.ran.map((x) => x.id)).toEqual([entry.choices![0].id]);
    const r = await s.choose(entry.id, 1, 'human');
    expect(r.status).toBe('nothing');
    expect(game.ran.length).toBe(1);
  });

  it('a new command clears a pending question', async () => {
    await s.handleText('talk to the youngster', 'human');
    await s.handleText('walk to the poke ball', 'human');
    game.ran = [];
    await s.handleText('two', 'human');
    expect(game.ran).toEqual([]);
  });

  it('routes a question to the answerer and presses nothing', async () => {
    const r = await s.handleText("what's good against rock types?", 'human');
    expect(game.ran).toEqual([]);
    expect(answerer.answer).toHaveBeenCalledOnce();
    expect(r).toEqual({ status: 'answer', message: 'Water beats Rock.' });
    expect(last()).toMatchObject({ status: 'answer', text: 'Water beats Rock.' });
  });

  it('declines what cannot be done from here', async () => {
    const r = await s.handleText('fly to cerulean city', 'human');
    expect(game.ran).toEqual([]);
    expect(r.message).toBe('I can only do things you can do from here.');
    expect(last().status).toBe('failed');
  });

  it('says so when nothing is possible right now', async () => {
    game.actions = [A('press:A', 'Press A', { kind: 'press' })];
    const r = await s.handleText('use ember', 'human');
    expect(r.message).toBe("Can't do that right now.");
    expect(game.ran).toEqual([]);
  });

  it('empty text produces no log entry', async () => {
    expect((await s.handleText('   ', 'human')).status).toBe('nothing');
    expect(logs).toEqual([]);
  });

  it('fast commands skip the interpreter', async () => {
    await s.handleText('left three', 'human');
    expect(game.ran).toEqual([{ id: 'steps:left', arg: 3 }]);
  });

  it('"stop" stops and never reaches the interpreter', async () => {
    game.script = never;
    const p = s.handleText('walk to the poke ball', 'human');
    await new Promise((r) => setTimeout(r, 20));
    await s.handleText('stop', 'human');
    expect((await p).status).toBe('stopped');
    expect(game.stop).toHaveBeenCalled();
    expect(statuses()).toContain('stopped');
  });
});

describe('Session: one sentence, two steps', () => {
  it('"use potion on pikachu" picks the potion, then answers the game’s "which Pokémon?" from the same sentence', async () => {
    game.script = (id) => { if (id === 'item:POTION') { game.actions = PARTY_MENU; return { status: 'prompt', message: 'Chose POTION. Now choose.' }; } return { status: 'done', message: 'Chose PIKACHU.' }; };
    await s.handleText('use potion on pikachu', 'human');
    expect(game.ran.map((x) => x.id)).toEqual(['item:POTION', 'menu:PIKACHU']);
  });

  it('stops at the game’s question when the sentence does not answer it', async () => {
    game.script = () => { game.actions = PARTY_MENU; return { status: 'prompt', message: 'Chose POTION. Now choose.' }; };
    const r = await s.handleText('use potion', 'human');
    expect(game.ran.map((x) => x.id)).toEqual(['item:POTION']);
    expect(r.status).toBe('prompt');
  });

  it('never chains a second follow-up', async () => {
    game.script = () => { game.actions = PARTY_MENU; return { status: 'prompt', message: 'Now choose.' }; };
    await s.handleText('use potion on pikachu', 'human');
    expect(game.ran.length).toBe(2);
  });
});

describe('Session: what the log records about a choice', () => {
  it('a stand-in choice records what was chosen, how surely, and by whom', async () => {
    await s.handleText('walk to the poke ball', 'human');
    expect(last()).toMatchObject({ heard: 'walk to the poke ball', chose: 'Examine the Poké Ball', by: 'standin', status: 'done' });
    expect(last().sure).toBeGreaterThan(0.5); expect(last().sure).toBeLessThanOrEqual(1);
    expect(typeof last().doneAt).toBe('number');
  });
  it('a choice by the real model is marked as Jev’s', async () => {
    const inner = new StandinJev();
    const real: JevBackend = { name: 'gateway', evaluate: (req) => inner.evaluate(req) };
    const sess = new Session({ game, interpreter: new Interpreter(new Jev({ backend: real, logFile: null }), inner), answerer, jev: 'gateway' });
    const seen: LogEntry[] = [];
    sess.on('log', (e: LogEntry) => seen.push({ ...e }));
    await sess.handleText('walk to the poke ball', 'human');
    expect(seen.at(-1)).toMatchObject({ chose: 'Examine the Poké Ball', by: 'jev' });
    expect(seen.at(-1)!.sure).toBeGreaterThan(0.5);
  });
  it('a fixed-grammar command is direct and has no percentage', async () => {
    await s.handleText('press a', 'human');
    expect(last()).toMatchObject({ by: 'direct', chose: 'Press A' });
    expect(last().sure).toBeUndefined();
  });
  it('a click, an agent’s action and a pick from "did you mean" are direct', async () => {
    await s.click(3, 3);
    expect(last()).toMatchObject({ by: 'direct' }); expect(last().chose).toBeTruthy();
    await s.runAction('npc:4', 'agent');
    expect(last()).toMatchObject({ by: 'direct', chose: 'Examine the Poké Ball', source: 'agent' });
    await s.handleText('talk to the youngster', 'human');
    expect(last().status).toBe('asking');
    await s.handleText('two', 'human');
    expect(last()).toMatchObject({ by: 'picked', chose: 'Talk to Youngster to the east' });
  });
  it('the chosen label carries no step count or result', async () => {
    await s.handleText('walk to the poke ball', 'human');
    expect(last().chose).not.toMatch(/steps|→/);
    expect(last().text).toMatch(/6 steps/);
  });
  it('an entry that is still running has no finish time', async () => {
    game.script = never;
    void s.runAction('npc:4', 'human');
    await new Promise((r) => setTimeout(r, 10));
    expect(last().status).toBe('running'); expect(last().doneAt).toBeUndefined();
  });
});

describe('Session: who has the controls', () => {
  it('lets an agent act in any mode when the player is idle', async () => {
    expect(s.mode).toBe('voice');
    expect((await s.runAction('npc:4', 'agent')).status).toBe('done');
    expect((await s.handleText('walk to the poke ball', 'agent')).status).toBe('done');
    s.set('mode', 'text');
    expect((await s.press(['A'], 'agent')).status).not.toBe('refused');
  });

  it('holds agents off for 5 s after the player stops, then lets them act', async () => {
    let t = 1000;
    const sess = new Session({ game, interpreter: new Interpreter(new Jev({ backend: new StandinJev(), logFile: null }), new StandinJev()), answerer, jev: 'standin', now: () => t });
    sess.stop('human');
    expect(await sess.runAction('npc:4', 'agent')).toEqual({ status: 'refused', message: 'The player pressed stop.' });
    expect(await sess.handleText('walk to the poke ball', 'agent')).toEqual({ status: 'refused', message: 'The player pressed stop.' });
    t += 4999;
    expect((await sess.press(['A'], 'agent')).status).toBe('refused');
    t += 1;
    expect((await sess.runAction('npc:4', 'agent')).status).toBe('done');
  });

  it('a spoken stop holds agents off too', async () => {
    await s.handleText('stop', 'human');
    expect((await s.runAction('npc:4', 'agent')).status).toBe('refused');
  });

  it('an agent’s own stop works and does not start the hold-off', async () => {
    game.script = (id) => (id === 'npc:2' ? never() : { status: 'done', message: 'Done.' });
    void s.runAction('npc:2', 'human');
    await new Promise((r) => setTimeout(r, 10));
    s.stop('agent');
    expect(game.stop).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 10));
    expect((await s.runAction('npc:4', 'agent')).status).toBe('done');
  });

  it('a human action interrupts an agent action', async () => {
    game.script = (id) => (id === 'npc:4' ? never() : { status: 'done', message: 'Done.' });
    const agent = s.runAction('npc:4', 'agent');
    await new Promise((r) => setTimeout(r, 10));
    await s.runAction('npc:2', 'human');
    expect(await agent).toEqual({ status: 'interrupted', message: 'Interrupted by the player.' });
    expect(game.ran.map((x) => x.id)).toEqual(['npc:4', 'npc:2']);
  });

  it('a raw button press stops a running action first', async () => {
    game.script = never;
    const p = s.runAction('npc:4', 'human');
    await new Promise((r) => setTimeout(r, 10));
    s.rawButton('down', 'LEFT');
    expect((await p).status).toBe('stopped');
    expect(game.ctl.heldButtons()).toEqual(['LEFT']);
    s.rawButton('up', 'LEFT');
    expect(game.ctl.heldButtons()).toEqual([]);
  });

  it('switches modes by voice and tells listeners', async () => {
    const infos: string[] = [];
    s.on('session', (i) => infos.push(i.mode));
    await s.handleText('text mode', 'human');
    await s.handleText('voice mode', 'human');
    expect(infos).toEqual(['text', 'voice']);
    await s.handleText('agent mode', 'human');
    expect(s.mode).toBe('voice');
  });

  it('applies settings to the game thread', () => {
    s.set('autoAdvance', false); s.set('advancePaceMs', 2500); s.set('speed', 2);
    expect([game.ctl.get(Slot.AUTO_ADVANCE), game.ctl.get(Slot.ADVANCE_PACE_MS), game.ctl.get(Slot.SPEED_X100)]).toEqual([0, 2500, 200]);
    expect(s.info()).toMatchObject({ autoAdvance: false, advancePaceMs: 2500, speed: 2, jev: 'standin', answers: true });
  });

  it('a click on the game screen walks there; nothing happens when the player cannot walk', async () => {
    await s.click(3, 3);
    expect(game.ran.map((x) => x.id)).toEqual(['tile:3,3']);
    game.tileAction.mockResolvedValueOnce(null);
    await s.click(1, 1);
    expect(game.ran.length).toBe(1);
  });
});

// ---- review findings 4-6: things that happen while something else is still in flight
import type { JevBackend } from '../../src/jev/types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** An interpreter whose model takes `ms` to answer, like a real network call. */
function slowSession(ms: number) {
  const inner = new StandinJev();
  const slow: JevBackend = { name: 'slow', evaluate: async (req) => { await sleep(ms); return inner.evaluate(req); } };
  const g = new FakeGame();
  const sess = new Session({ game: g, interpreter: new Interpreter(new Jev({ backend: slow, logFile: null }), inner), answerer: { enabled: false, answer: async () => '' }, jev: 'standin' });
  return { g, sess };
}

describe('Session: while a command is still being worked out', () => {
  it('"stop" cancels it: the action never starts', async () => {
    const { g, sess } = slowSession(120);
    const p = sess.handleText('walk to the poke ball', 'human');
    await sleep(30);
    sess.stop('human');
    expect((await p).status).toBe('stopped');
    await sleep(150);
    expect(g.ran).toEqual([]);
  });

  it('a newer command replaces it', async () => {
    const { g, sess } = slowSession(120);
    const first = sess.handleText('walk to the poke ball', 'human');
    await sleep(30);
    await sess.handleText('left three', 'human');
    expect((await first).status).toBe('stopped');
    await sleep(150);
    expect(g.ran.map((x) => x.id)).toEqual(['steps:left']);
  });

  it('an agent’s command does not run if the player took the controls back meanwhile', async () => {
    const { g, sess } = slowSession(120);
    const p = sess.handleText('walk to the poke ball', 'agent');
    await sleep(30);
    sess.rawButton('tap', 'B');
    expect((await p).status).not.toBe('done');
    await sleep(150);
    expect(g.ran).toEqual([]);
  });

  it('a button press cancels it too', async () => {
    const { g, sess } = slowSession(120);
    const p = sess.handleText('walk to the poke ball', 'human');
    await sleep(30);
    sess.rawButton('tap', 'B');
    expect((await p).status).toBe('stopped');
    expect(g.ran).toEqual([]);
  });
});

describe('Session: the player always wins', () => {
  it('a click during a running action stops it first, then walks to the clicked spot', async () => {
    game.script = (id) => (id === 'npc:4' ? never() : { status: 'done', message: 'Walked there.' });
    // like the real game thread: it cannot say what a click means until the running action has ended
    game.tileAction.mockImplementation(async () => { while (game.busy) await sleep(5); return 'tile:3,3'; });
    const walking = s.runAction('npc:4', 'human');
    await sleep(20);
    const r = await Promise.race([s.click(3, 3), sleep(1000).then(() => 'hung')]);
    expect(r).not.toBe('hung');
    expect((await walking).status).toBe('stopped');
    expect(game.ran.map((x) => x.id)).toEqual(['npc:4', 'tile:3,3']);
  });

  it('an agent cannot replace an action the player started', async () => {
    game.script = (id) => (id === 'npc:2' ? never() : { status: 'done', message: 'Done.' });
    const mine = s.runAction('npc:2', 'human');
    await sleep(20);
    expect(await s.runAction('npc:4', 'agent')).toEqual({ status: 'refused', message: 'The player is doing something. Wait for it to finish.' });
    expect(await s.press(['A'], 'agent')).toMatchObject({ status: 'refused' });
    expect(game.ran.map((x) => x.id)).toEqual(['npc:2']);
    s.stop('human'); await mine;
    // the player's stop holds agents off for a moment (see the hold-off tests above)
    expect(await s.runAction('npc:4', 'agent')).toEqual({ status: 'refused', message: 'The player pressed stop.' });
  });

  it('an agent cannot act while the player is holding a button', async () => {
    s.rawButton('down', 'LEFT');
    expect((await s.runAction('npc:4', 'agent')).status).toBe('refused');
    s.rawButton('up', 'LEFT');
    expect((await s.runAction('npc:4', 'agent')).status).toBe('done');
  });

  it('a pending "did you mean" is dropped once the player presses a button', async () => {
    await s.handleText('talk to the youngster', 'human');
    s.rawButton('tap', 'B');
    await s.handleText('two', 'human');
    expect(game.ran).toEqual([]);
  });

  it('a paragraph gets one plain line and runs nothing', async () => {
    const r = await s.handleText('walk to the poke ball '.repeat(20), 'human');
    expect(r).toEqual({ status: 'failed', message: "That's too long to be a command. Say one thing at a time." });
    expect(game.ran).toEqual([]);
    expect(last().status).toBe('failed');
  });

});

describe('Session: an agent never gets in front of the player', () => {
  it('an agent is refused while the player’s command is still being worked out, and that command still runs', async () => {
    const { g, sess } = slowSession(120);
    const mine = sess.handleText('walk to the poke ball', 'human');
    await sleep(30);
    expect(await sess.runAction('npc:2', 'agent')).toEqual({ status: 'refused', message: 'The player is doing something. Wait for it to finish.' });
    expect((await sess.press(['A'], 'agent')).status).toBe('refused');
    expect((await sess.handleText('step left', 'agent')).status).toBe('refused');
    expect((await mine).status).toBe('done');
    expect(g.ran.map((x) => x.id)).toEqual(['npc:4']);
    expect((await sess.runAction('npc:2', 'agent')).status).toBe('done'); // and free again afterwards
  });

  it('an agent is refused while the player’s click is being worked out', async () => {
    game.tileAction.mockImplementation(async () => { await sleep(80); return 'tile:3,3'; });
    const mine = s.click(3, 3);
    await sleep(20);
    expect((await s.runAction('npc:2', 'agent')).status).toBe('refused');
    expect((await mine).status).toBe('done');
    expect(game.ran.map((x) => x.id)).toEqual(['tile:3,3']);
  });

  it('an agent cannot wipe a question the player has just been asked', async () => {
    await s.handleText('talk to the youngster', 'human');
    expect(last().status).toBe('asking');
    expect((await s.runAction('npc:4', 'agent')).status).toBe('refused');
    await s.handleText('two', 'human');
    expect(game.ran.map((x) => x.id)).toEqual(['npc:3']);
  });

  it('a question the player leaves unanswered stops holding agents off after 30 s', async () => {
    let t = 1000;
    const sess = new Session({ game, interpreter: new Interpreter(new Jev({ backend: new StandinJev(), logFile: null }), new StandinJev()), answerer, jev: 'standin', now: () => t });
    await sess.handleText('talk to the youngster', 'human');
    expect((await sess.runAction('npc:4', 'agent')).status).toBe('refused');
    t += 30_000;
    expect((await sess.runAction('npc:4', 'agent')).status).toBe('done');
  });
});

describe('Session: what the strip is told about follow-ups and picks', () => {
  it('a follow-up step keeps the words the player said', async () => {
    game.script = () => { game.actions = PARTY_MENU; return { status: 'prompt', message: 'Now choose.' }; };
    await s.handleText('use potion on pikachu', 'human');
    expect(game.ran.length).toBe(2);
    expect(last()).toMatchObject({ heard: 'use potion on pikachu', chose: 'PIKACHU' });
  });
  it('a pick from "did you mean" is marked as the player’s pick and keeps the original words', async () => {
    await s.handleText('talk to the youngster', 'human');
    const q = last();
    await s.choose(q.id, 0, 'human');
    expect(last()).toMatchObject({ by: 'picked', chose: 'Talk to Youngster to the north', heard: 'talk to the youngster' });
    await s.handleText('talk to the youngster', 'human');
    await s.handleText('two', 'human');
    expect(last()).toMatchObject({ by: 'picked', heard: 'two' });
  });
  it('a question dropped by a button press is closed in the log, so it stops being offered', async () => {
    await s.handleText('talk to the youngster', 'human');
    const q = last();
    s.rawButton('tap', 'B');
    expect(logs.find((l) => l.id === q.id)).toMatchObject({ status: 'stopped' });
  });
});

describe('Session: naming screens', () => {
  const NAMING = [A('name', 'Type a name', { kind: 'name' }), A('press:A', 'Press A', { kind: 'press' })];
  it('types the name out of a sentence that is not in the fixed grammar', async () => {
    game.actions = NAMING;
    await s.handleText("Let's go with Leo as the name", 'human');
    expect(game.ran).toEqual([{ id: 'name', arg: { text: 'Leo' } }]);
  });
  it('types a name said on its own', async () => {
    game.actions = NAMING;
    await s.handleText('Leo', 'human');
    expect(game.ran).toEqual([{ id: 'name', arg: { text: 'Leo' } }]);
  });
  it('joins a two-word name', async () => {
    game.actions = NAMING;
    await s.handleText('go with Big Red', 'human');
    expect(game.ran).toEqual([{ id: 'name', arg: { text: 'BigRed' } }]);
    game.ran = [];
    await s.handleText('call it Big Red', 'human');   // the fixed grammar's form; the game drops the space when typing
    expect(game.ran).toEqual([{ id: 'name', arg: { text: 'Big Red' } }]);
  });
  it('asks for the name when the sentence has none in it, and types nothing', async () => {
    game.actions = NAMING;
    const r = await s.handleText("let's go with the name", 'human');
    expect(game.ran).toEqual([]);
    expect(r).toEqual({ status: 'failed', message: 'Which name? Say just the name, like "Leo".' });
  });
});

describe('Session: movement, names in a follow-up, and saying what is possible', () => {
  it('a step chosen by the model takes its count from the sentence', async () => {
    game.actions = [...WORLD, A('steps:right', 'Step right', { kind: 'steps' })];
    await s.handleText('step to the right three times please', 'human');
    await s.handleText('step to the right please', 'human');
    await s.handleText('step all the way to the right please', 'human');
    expect(game.ran).toEqual([{ id: 'steps:right', arg: 3 }, { id: 'steps:right', arg: 1 }, { id: 'steps:right', arg: 20 }]);
  });

  it('"let’s name him Shigeru" on the name menu chooses NEW NAME, then types the name', async () => {
    const NAME_MENU = [A('menu:NEW NAME', 'NEW NAME', { kind: 'menu' }), A('menu:BLUE', 'BLUE', { kind: 'menu' }), A('menu:GARY', 'GARY', { kind: 'menu' })];
    // the real Jev reads this sentence as "NEW NAME" (seen live at 0.86); the word-matcher cannot, so the model is played here
    const picks: JevBackend = { name: 'gateway', evaluate: async (): Promise<any> => ({ answers: { intent: { type: 'choice', choice: 'menu:NEW NAME', probabilities: { 'menu:NEW NAME': 0.86, __impossible: 0.09 } } }, usage: {} }) };
    const g = new FakeGame();
    const sess = new Session({ game: g, interpreter: new Interpreter(new Jev({ backend: picks, logFile: null }), new StandinJev()), answerer: { enabled: false, answer: async () => '' }, jev: 'standin' });
    g.actions = NAME_MENU;
    g.script = (id) => {
      if (id === 'menu:NEW NAME') { g.actions = [A('name', 'Type a name', { kind: 'name' })]; return { status: 'prompt', message: 'Chose NEW NAME. Now it wants a name.' }; }
      return { status: 'done', message: 'Typed SHIGERU.' };
    };
    await sess.handleText("Let's name him Shigeru", 'human');
    expect(g.ran).toEqual([{ id: 'menu:NEW NAME', arg: undefined }, { id: 'name', arg: { text: 'Shigeru' } }]);
  });

  it('when nothing fits, the log says what can be done here', async () => {
    await s.handleText('move in front of the bed', 'human');
    expect(last().status).toBe('failed');
    expect(last().text).toContain('I can only do things you can do from here.');
    expect(last().text).toContain('Examine the Poké Ball');
    expect(last().text).toMatch(/step/i);
    expect(last().text).not.toMatch(/Press A/);
  });
});

describe('Session: the real Jev is shown the screen', () => {
  it('sends a picture of the game with the command when the real Jev is in use', async () => {
    const g = new FakeGame();
    const seen: any[] = [];
    const eyes: JevBackend = { name: 'gateway', evaluate: async (req): Promise<any> => { seen.push(req); return { answers: { intent: { type: 'choice', choice: 'npc:4', probabilities: { 'npc:4': 0.95 } } }, usage: {} }; } };
    (g as any).screenPng = async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const sess = new Session({ game: g, interpreter: new Interpreter(new Jev({ backend: eyes, logFile: null }), new StandinJev()), answerer: { enabled: false, answer: async () => '' }, jev: 'gateway' });
    await sess.handleText('walk to the poke ball', 'human');
    expect(seen[0].image).toBeInstanceOf(Buffer);
    expect(g.ran.map((x) => x.id)).toEqual(['npc:4']);
  });
  it('takes no picture for the stand-in, which cannot see', async () => {
    let shots = 0;
    (game as any).screenPng = async () => { shots++; return Buffer.from([1]); };
    await s.handleText('walk to the poke ball', 'human');
    expect(shots).toBe(0);
  });
});

import { stepCount } from '../../src/server/session.js';
describe('stepCount', () => {
  it.each([['step right', 1], ['a couple of steps left', 2], ['a few steps up', 3], ['go right 4', 4], ['three steps', 3], ['all the way down', 20], ['25 steps', 20]])('%s → %i', (said, n) => {
    expect(stepCount(said as string)).toBe(n);
  });
});

describe('Session: opening a menu never picks from it', () => {
  it('"attack" opens FIGHT and stops, even if the model would then favour a move', async () => {
    const MOVES = [A('menu:SCRATCH', 'SCRATCH', { kind: 'menu' }), A('menu:GROWL', 'GROWL', { kind: 'menu' })];
    // the model as it behaved live: FIGHT for the first question, then SCRATCH (here: very sure) for the follow-up
    const eager: JevBackend = { name: 'gateway', evaluate: async (req): Promise<any> => {
      const c = (req.questions.intent as any).criteria;
      const pick = c['battle:FIGHT'] ? 'battle:FIGHT' : 'menu:SCRATCH';
      return { answers: { intent: { type: 'choice', choice: pick, probabilities: { [pick]: 0.99 } } }, usage: {} };
    } };
    const g = new FakeGame();
    const sess = new Session({ game: g, interpreter: new Interpreter(new Jev({ backend: eager, logFile: null }), new StandinJev()), answerer: { enabled: false, answer: async () => '' }, jev: 'standin' });
    g.actions = [A('battle:FIGHT', 'FIGHT', { kind: 'menu' }), A('move:SCRATCH', 'Use SCRATCH', { kind: 'move' })];
    g.script = () => { g.actions = MOVES; return { status: 'prompt', message: 'Opened FIGHT. Now choose.' }; };
    const r = await sess.handleText('attack', 'human');
    expect(g.ran.map((x) => x.id)).toEqual(['battle:FIGHT']);
    expect(r.status).toBe('prompt');
  });
});

describe('stepCount: keep going', () => {
  it.each(['keep going north', 'continue that way', 'carry on up', 'keep walking', 'go north until something is in the way', 'head up until you hit something'])('%s → until blocked', (said) => {
    expect(stepCount(said)).toBe(20);
  });
});

describe('Session: terrain by its everyday name', () => {
  it('"go into grass" picks the tall grass option', async () => {
    game.actions = [A('terrain:grass:3,4@12', 'Walk into the tall grass', { kind: 'go' }), A('sign:5,5@12', 'Read the sign'), A('steps:up', 'Step up', { kind: 'steps' }), A('press:A', 'Press A', { kind: 'press' })];
    await s.handleText('Go into grass.', 'human');
    expect(game.ran).toEqual([{ id: 'terrain:grass:3,4@12', arg: undefined }]);
  });
});

describe('Session: a sentence with several commands', () => {
  it('carries out each part in order, each as its own entry', async () => {
    const r = await s.handleText('Walk to the poke ball and talk to the youngster to the north.', 'human');
    expect(game.ran.map((x) => x.id)).toEqual(['npc:4', 'npc:2']);
    expect(r.status).toBe('done');
    const mine = logs.filter((l) => l.chose);
    expect(mine.map((l) => l.heard)).toEqual(['Walk to the poke ball', 'talk to the youngster to the north']);
  });
  it('fixed-grammar parts work too, with their counts', async () => {
    await s.handleText('left three then press a', 'human');
    expect(game.ran).toEqual([{ id: 'steps:left', arg: 3 }, { id: 'press:A', arg: undefined }]);
  });
  it('stops at the first part that does not simply finish', async () => {
    game.script = (id) => (id === 'npc:4' ? { status: 'prompt', message: 'It asks something.' } : { status: 'done', message: 'Done.' });
    const r = await s.handleText('walk to the poke ball then talk to the youngster to the north', 'human');
    expect(game.ran.map((x) => x.id)).toEqual(['npc:4']);
    expect(r.status).toBe('prompt');
  });
  it('a part that cannot be done ends the chain and is reported', async () => {
    const r = await s.handleText('walk to the poke ball then examine the unicorn', 'human');
    expect(game.ran.map((x) => x.id)).toEqual(['npc:4']);
    expect(r.status).toBe('failed');
    expect(last()).toMatchObject({ status: 'failed', heard: 'examine the unicorn' });
  });
  it('stop during the first part means the rest never runs', async () => {
    game.script = (id) => (id === 'npc:4' ? never() : { status: 'done', message: 'Done.' });
    const p = s.handleText('walk to the poke ball then talk to the youngster to the north', 'human');
    await sleep(20);
    s.stop('human');
    expect((await p).status).toBe('stopped');
    await sleep(20);
    expect(game.ran.map((x) => x.id)).toEqual(['npc:4']);
  });
  it('a button press between parts ends the chain', async () => {
    game.script = async (id) => { if (id === 'npc:4') { s.rawButton('tap', 'B'); } return { status: 'done', message: 'Done.' }; };
    await s.handleText('walk to the poke ball then talk to the youngster to the north', 'human');
    expect(game.ran.map((x) => x.id)).toEqual(['npc:4']);
  });
  it('an agent’s chain gives way to the player part-way through', async () => {
    game.script = (id) => (id === 'npc:4' ? never() : { status: 'done', message: 'Done.' });
    const p = s.handleText('walk to the poke ball then talk to the youngster to the north', 'agent');
    await sleep(20);
    await s.runAction('npc:3', 'human');
    expect((await p).status).toBe('interrupted');
    expect(game.ran.map((x) => x.id)).toEqual(['npc:4', 'npc:3']);
  });
});

describe('Session: carrying on until the command is done', () => {
  /** A real-model stand-in that answers each call with the next scripted choice. */
  function scripted(choices: string[]) {
    let n = 0; const seen: any[] = [];
    const backend: JevBackend = { name: 'gateway', evaluate: async (req) => {
      seen.push(req.state);
      const choice = choices[Math.min(n++, choices.length - 1)];
      return { answers: { intent: { type: 'choice', choice, probabilities: { [choice]: 0.95, __impossible: 0.05 } } }, usage: {} };
    } };
    const sess = new Session({ game, interpreter: new Interpreter(new Jev({ backend, logFile: null }), new StandinJev()), answerer, jev: 'gateway' });
    return { sess, seen, calls: () => n };
  }

  it('asks the model again after each action and stops when it says everything is done', async () => {
    const { sess, seen, calls } = scripted(['npc:4', 'npc:2', '__done']);
    const r = await sess.handleText('get to the ball by way of the youngster', 'human');
    expect(game.ran.map((x) => x.id)).toEqual(['npc:4', 'npc:2']);
    expect(r.status).toBe('done');
    expect(calls()).toBe(3);
    expect(seen[1].alreadyDone).toEqual(['Examine the Poké Ball']);
    expect(seen[2].alreadyDone).toEqual(['Examine the Poké Ball', 'Talk to Youngster to the north']);
  });
  it('never does the same thing twice for one command', async () => {
    const { sess } = scripted(['npc:4', 'npc:4']);
    await sess.handleText('go to the ball', 'human');
    expect(game.ran.map((x) => x.id)).toEqual(['npc:4']);
  });
  it('never carries on into something hard to undo', async () => {
    game.actions = [...WORLD, A('item:TOSS', 'Toss the POTION', { costly: true })];
    const { sess } = scripted(['npc:4', 'item:TOSS']);
    await sess.handleText('go to the ball', 'human');
    expect(game.ran.map((x) => x.id)).toEqual(['npc:4']);
  });
  it('does not carry on past anything the game asks, or after a failure', async () => {
    game.script = (id) => (id === 'npc:4' ? { status: 'interrupted', message: 'A wild Pokémon appeared.' } : { status: 'done', message: 'Done.' });
    const { sess, calls } = scripted(['npc:4', 'npc:2']);
    await sess.handleText('go to the ball', 'human');
    expect(game.ran.map((x) => x.id)).toEqual(['npc:4']);
    expect(calls()).toBe(1);
  });
  it('gives up after eight actions', async () => {
    game.actions = Array.from({ length: 12 }, (_, i) => A(`npc:${i}`, `Thing number ${i}`));
    const { sess } = scripted(game.actions.map((a) => a.id));
    await sess.handleText('do the rounds', 'human');
    expect(game.ran).toHaveLength(8);
  });
  it('stop ends it between actions', async () => {
    const { sess } = scripted(['npc:4', 'npc:2', 'npc:3']);
    game.script = async (id) => { if (id === 'npc:2') sess.stop('human'); return { status: 'done', message: 'Done.' }; };
    await sess.handleText('go to the ball', 'human');
    expect(game.ran.map((x) => x.id)).toEqual(['npc:4', 'npc:2']);
  });
  it('fixed-grammar commands are exact: nothing is asked afterwards', async () => {
    const { sess, calls } = scripted(['npc:4']);
    await sess.handleText('left three', 'human');
    expect(game.ran).toEqual([{ id: 'steps:left', arg: 3 }]);
    expect(calls()).toBe(0);
  });
});

describe('Session: spoken answers', () => {
  const Q = "what's good against rock types?";
  let speaker: { speak: import('vitest').Mock<(t: string) => Promise<Int16Array | null>> };
  let sp: Session, voices: [number, Int16Array][], hushes: number;
  /** an answerer that streams `parts` (each the whole answer so far) and returns `final` */
  const streams = (parts: string[], final = parts[parts.length - 1]) => {
    answerer.answer.mockImplementation(async (_q, _s, d) => { for (const p of parts) d?.(p); return final; });
  };
  beforeEach(() => {
    speaker = { speak: vi.fn(async (t: string) => Int16Array.of(t.length)) };
    sp = new Session({ game, interpreter: new Interpreter(new Jev({ backend: new StandinJev(), logFile: null }), new StandinJev()), answerer, jev: 'standin', speaker });
    voices = []; hushes = 0;
    sp.on('voice', (id: number, pcm: Int16Array) => voices.push([id, pcm]));
    sp.on('hush', () => hushes++);
  });

  it("speaks each sentence of the player's answer, in order", async () => {
    streams(['Onix is weak to Water.', 'Onix is weak to Water. Use Bubble.']);
    const ids: string[] = [];
    sp.on('log', (e: LogEntry) => ids.push(e.id));
    await sp.handleText(Q, 'human');
    await sp.voiceQueue;
    expect(speaker.speak.mock.calls.map((c) => c[0])).toEqual(['Onix is weak to Water.', 'Use Bubble.']);
    expect(voices.map(([, pcm]) => pcm[0])).toEqual([22, 11]);
    expect(voices.every(([id]) => String(id) === ids[0])).toBe(true);
  });

  it("never speaks an agent's question", async () => {
    await sp.handleText(Q, 'agent');
    await sp.voiceQueue;
    expect(speaker.speak).not.toHaveBeenCalled();
  });

  it('skips a sentence the speaker could not make and carries on', async () => {
    streams(['One. Two.']);
    speaker.speak.mockResolvedValueOnce(null);
    await sp.handleText(Q, 'human');
    await sp.voiceQueue;
    expect(speaker.speak).toHaveBeenCalledTimes(2);
    expect(voices).toHaveLength(1);
  });

  it('speaks the final reply when it replaced what streamed', async () => {
    streams(['Here is how. Then'], "I can't answer that one.");
    await sp.handleText(Q, 'human');
    await sp.voiceQueue;
    expect(speaker.speak).toHaveBeenLastCalledWith("I can't answer that one.");
    expect(hushes).toBeGreaterThanOrEqual(1);
  });

  it('stop hushes the voice and drops sentences not yet spoken', async () => {
    streams(['One. Two. Three.']);
    let release!: () => void;
    speaker.speak.mockImplementationOnce((t) => new Promise((r) => { release = () => r(Int16Array.of(t.length)); }));
    await sp.handleText(Q, 'human');
    const before = hushes;
    sp.stop('human');
    release();
    await sp.voiceQueue;
    expect(hushes).toBe(before + 1);
    expect(speaker.speak).toHaveBeenCalledTimes(1);
    expect(voices).toHaveLength(0);
  });

  it('a new question cuts off the old answer', async () => {
    streams(['Old one. Old two.']);
    let release!: () => void;
    speaker.speak.mockImplementationOnce((t) => new Promise((r) => { release = () => r(Int16Array.of(t.length)); }));
    await sp.handleText(Q, 'human');
    streams(['New one.']);
    await sp.handleText(Q, 'human');
    release();
    await sp.voiceQueue;
    expect(speaker.speak.mock.calls.map((c) => c[0])).toEqual(['Old one.', 'New one.']);
    expect(voices.map(([, pcm]) => pcm[0])).toEqual([8]);
  });

  it('reports whether it can speak', () => {
    expect(sp.info().speech).toBe(true);
    expect(s.info().speech).toBe(false);
  });
});
