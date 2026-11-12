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
  state: any = { mode: 'overworld', map: 'VIRIDIAN_CITY', dialog: '', party: [], running: null };
  actions: Action[] = WORLD;
  ran: { id: string; arg?: unknown }[] = [];
  script: (id: string) => ActionResult | Promise<ActionResult> = () => ({ status: 'done', message: 'Done.' });
  private settle: ((r: ActionResult) => void) | null = null;
  busy = false;
  stop = vi.fn(() => { this.settle?.({ status: 'stopped', message: 'Stopped.' }); });
  save = vi.fn(async () => {});
  load = vi.fn(async () => {});
  tileAction = vi.fn(async () => 'tile:3,3' as string | null);
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

describe('Session: who has the controls', () => {
  it('refuses agent actions outside agent mode but lets agents stop', async () => {
    expect(await s.runAction('npc:4', 'agent')).toEqual({ status: 'refused', message: 'The player has the controls.' });
    expect(await s.handleText('walk to the poke ball', 'agent')).toEqual({ status: 'refused', message: 'The player has the controls.' });
    expect(game.ran).toEqual([]);
    game.script = never;
    void s.runAction('npc:4', 'human');
    await new Promise((r) => setTimeout(r, 10));
    s.stop('agent');
    expect(game.stop).toHaveBeenCalled();
  });

  it('lets agents act in agent mode', async () => {
    s.set('mode', 'agent');
    expect((await s.runAction('npc:4', 'agent')).status).toBe('done');
    expect((await s.handleText('walk to the poke ball', 'agent')).status).toBe('done');
  });

  it('in agent mode, human text other than stop or a mode switch is refused', async () => {
    s.set('mode', 'agent');
    expect(await s.handleText('walk to the poke ball', 'human')).toEqual({ status: 'refused', message: 'Agent mode: say "stop" or "voice mode" to take over.' });
    expect(game.ran).toEqual([]);
    await s.handleText('voice mode', 'human');
    expect(s.mode).toBe('voice');
  });

  it('a human action interrupts an agent action', async () => {
    s.set('mode', 'agent');
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
    await s.handleText('agent mode', 'human');
    await s.handleText('voice mode', 'human');
    expect(infos).toEqual(['agent', 'voice']);
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
