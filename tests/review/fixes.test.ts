// Regression tests for the findings of the whole-branch review.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { startServer } from '../../src/server/main.js';
import { GameClient } from '../../src/server/game.js';
import { fastPath } from '../../src/interpret/fastpath.js';
import { Interpreter } from '../../src/interpret/interpreter.js';
import { Jev } from '../../src/jev/client.js';
import { StandinJev } from '../../src/jev/standin.js';
import type { JevBackend } from '../../src/jev/types.js';
import { parseClientMsg } from '../../src/server/wire.js';
import { isCostlyScreen, isCostlyOption } from '../../src/actions/menu.js';
import { AutoAdvance, dueFor, type AdvanceView } from '../../src/actions/advance.js';
import { listActions, runAction } from '../../src/actions/index.js';
import { detectMode } from '../../src/game/mode.js';
import type { Action } from '../../src/actions/types.js';
import type { GameSnapshot } from '../../src/game/snapshot.js';
import { hasRom, hasFixture, boot, ROM_PATH } from '../helpers/rom.js';

const A = (id: string, label: string, extra: Partial<Action> = {}) => ({ id, kind: 'interact', label, ...extra }) as Action;
const S: GameSnapshot = {
  mode: 'battle', map: 'ROUTE_1', x: 1, y: 1, facing: 'down', money: 0, badges: 0, pokedex: { seen: 0, owned: 0 }, playTime: '0:00',
  party: [{ slot: 0, speciesId: 1, species: 'PIKACHU', nickname: 'SPARKY', level: 5, hp: 10, maxHp: 10, status: 'OK', types: [], moves: [] }],
  bag: [], battle: null, dialog: '', running: null,
};
const acts = [
  A('ball:MASTER BALL', 'Throw MASTER BALL', { costly: true }), A('ball:ULTRA BALL', 'Throw ULTRA BALL'), A('item:POTION', 'Use POTION', { kind: 'item' }),
  A('run', 'Run away'), A('menu:YES', 'YES', { kind: 'menu', costly: true }), A('menu:NO', 'NO', { kind: 'menu' }),
];
const I = () => new Interpreter(new Jev({ backend: new StandinJev(), logFile: null }), new StandinJev());

describe('2. the stand-in does not act on words in passing', () => {
  it.each([
    "don't throw the master ball", 'no wait not the master ball', 'I think we should run this by him later',
    'use super potion', 'not yes', 'never run',
  ])('"%s" runs nothing', async (said) => {
    expect((await I().interpret(said, acts, S)).kind).not.toBe('act');
  });
  it('still acts on a plain command, and on one that also names a party member', async () => {
    expect(await I().interpret('throw the ultra ball', acts, S)).toMatchObject({ kind: 'act', action: { id: 'ball:ULTRA BALL' } });
    expect(await I().interpret('use potion on sparky', acts, S)).toMatchObject({ kind: 'act', action: { id: 'item:POTION' } });
    expect(await I().interpret('use potion on pikachu', acts, S)).toMatchObject({ kind: 'act', action: { id: 'item:POTION' } });
    expect(await I().interpret('run', acts, S)).toMatchObject({ kind: 'act', action: { id: 'run' } });
  });
  it('refuses a paragraph outright instead of acting on its first 200 characters', async () => {
    const para = 'run '.repeat(1) + 'so anyway I was telling her about the trip and how the weather turned and we had to come back early which was a shame because the place was lovely and the food was great and then the car broke down on the way home';
    expect(para.length).toBeGreaterThan(200);
    expect(await I().interpret(para, acts, S)).toMatchObject({ kind: 'nothing', reason: 'long' });
  });
});

describe('3. stop is heard however it is said', () => {
  const has = () => false;
  it.each(['stop it', 'stop stop', 'Stop, stop!', 'please stop', 'stop walking', 'wait stop', 'ok stop now', 'halt'])('"%s" stops', (said) => {
    expect(fastPath(said, has, false)).toEqual({ kind: 'stop' });
  });
  it('a long sentence that merely contains the word is not a stop', () => {
    expect(fastPath('walk to the bus stop sign next to the poke mart over there', has, false)).toBeNull();
  });
});

describe('interpreter: an answer without probabilities is never acted on unasked', () => {
  it('asks instead', async () => {
    const bare: JevBackend = { name: 'bare', evaluate: async () => ({ answers: { intent: { type: 'choice', choice: 'ball:MASTER BALL' } }, usage: {} }) };
    const r = await new Interpreter(new Jev({ backend: bare, logFile: null }), new StandinJev()).interpret('throw it', acts, S);
    expect(r).toMatchObject({ kind: 'clarify' });
    if (r.kind === 'clarify') expect(r.options.map((o) => o.id)).toEqual(['ball:MASTER BALL']);
  });
});

describe('wire: text has a size limit', () => {
  it('rejects text over 2000 characters', () => {
    expect(parseClientMsg(JSON.stringify({ type: 'text', text: 'x'.repeat(2001) }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ type: 'text', text: 'x'.repeat(2000) }))).not.toBeNull();
  });
});

describe('8. hard-to-undo screens are recognised from the game’s real wording', () => {
  it.each([
    'Which move should be forgotten?', 'Delete an older move to make room for CUT?', 'The older file will be erased to save. Okay?',
    'Is it OK to toss POTION?', 'Once released, PIDGEY is gone forever. OK?', 'Would you like to SAVE the game?',
  ])('"%s"', (text) => { expect(isCostlyScreen(text)).toBe(true); });
  it('ordinary prompts are not costly', () => {
    expect(isCostlyScreen('Do you want to give a nickname to CHARMANDER?')).toBe(false);
    expect(isCostlyScreen('First, what is your name?')).toBe(false);
  });
  it('TOSS, RELEASE and a Master Ball picked from a list are costly options', () => {
    for (const l of ['TOSS', 'RELEASE', 'MASTER BALL']) expect(isCostlyOption(l)).toBe(true);
    expect(isCostlyOption('POTION')).toBe(false);
  });
});

describe('9. auto-advance only continues plain dialogue', () => {
  const view = (v: Partial<AdvanceView>): AdvanceView => ({ mode: 'dialog', cursor: false, naming: false, hasTextBox: true, dialog: 'Hello there!', rows: ['Hello there!'], ...v });
  const fires = (v: AdvanceView) => { const a = new AutoAdvance(); dueFor(a, v, 0, 1000); return dueFor(a, v, 5000, 1000); };
  it('continues unchanged dialogue after the reading time', () => { expect(fires(view({}))).toBe(true); });
  it('leaves full-screen pages (stats, Pokédex entry, map) for the player to close', () => {
    expect(fires(view({ hasTextBox: false, dialog: '', rows: ['CHARMANDER', 'LIZARD', 'HT 2 00'] }))).toBe(false);
  });
  it('never presses A on a quantity box (the hollow cursor), which would answer "How many?" for the player', () => {
    expect(fires(view({ dialog: 'How many?', rows: ['How many?', '│▷×01  ¥200│'] }))).toBe(false);
  });
});

describe.skipIf(!hasFixture('fx-pallet'))('7. talking to someone who wanders', () => {
  it('never reports a talk that did not happen', () => {
    let talked = 0;
    for (let i = 0; i < 14; i++) {
      const ctx = boot('fx-pallet');
      ctx.emu.wait(i * 41);
      const talk = listActions(ctx).filter((a) => /^Talk to/.test(a.label));
      const a = talk[i % talk.length];
      const r = runAction(ctx, a.id);
      if (r.status === 'prompt') { talked++; expect(ctx.gs.screen().hasTextBox).toBe(true); }
      else expect(r.status, `${a.label}: ${r.message}`).not.toBe('done');
    }
    expect(talked).toBeGreaterThan(6);
  });
  it('ids of things on the map name the map, so an old id cannot mean something else elsewhere', () => {
    const ctx = boot('fx-pallet');
    const positional = listActions(ctx).filter((a) => /^(npc|sign|hidden|warp):/.test(a.id));
    expect(positional.length).toBeGreaterThan(3);
    expect(positional.every((a) => a.id.endsWith(`@${ctx.gs.mapId}`))).toBe(true);
    const door = positional.find((a) => a.id.startsWith('warp:'))!;
    runAction(ctx, door.id);
    expect(runAction(ctx, door.id).status).toBe('failed');
  });
});

describe.skipIf(!hasRom)('10. the game thread failing is reported, not a silent hang', () => {
  it('a corrupt save does not stop the game from starting', async () => {
    fs.mkdirSync('saves', { recursive: true });
    fs.writeFileSync('saves/t-corrupt.state.json', '{"frames": 12, "state": [1,2');
    const g = await GameClient.start({ romPath: ROM_PATH, resume: 't-corrupt', autosave: false });
    expect(g.state.mode).toBe('boot');
    await g.shutdown();
    fs.rmSync('saves/t-corrupt.state.json');
  });
  it('if the game thread dies, waiting calls fail and a crash is announced', async () => {
    const g = await GameClient.start({ romPath: ROM_PATH, autosave: false });
    const crashed = once(g, 'crashed');
    const p = g.run('wait');
    await (g as any).worker.terminate();
    await expect(p).rejects.toThrow(/game stopped/i);
    await crashed;
    await expect(g.save('t-after-crash')).rejects.toThrow(/game stopped/i);
  });
  it('saving never leaves a half-written file behind', async () => {
    const g = await GameClient.start({ romPath: ROM_PATH, autosave: false });
    await g.save('t-atomic');
    expect(() => JSON.parse(fs.readFileSync('saves/t-atomic.state.json', 'utf8'))).not.toThrow();
    expect(fs.readdirSync('saves').filter((f) => f.includes('.tmp'))).toEqual([]);
    await g.shutdown();
  });
});

describe.skipIf(!hasRom)('1. only the app’s own page may connect', () => {
  it('refuses a WebSocket opened by another website, and accepts the app’s own page', async () => {
    const { url, close } = await startServer({ port: 0, fresh: true, autosave: false });
    const wsUrl = url.replace('http', 'ws') + '/ws';
    const evil = new WebSocket(wsUrl, { origin: 'https://evil.example' });
    const [err] = await once(evil, 'error');
    expect(String(err)).toMatch(/403/);
    const own = new WebSocket(wsUrl, { origin: url });
    await once(own, 'open');
    own.close();
    const none = new WebSocket(wsUrl); // a local tool with no Origin header
    await once(none, 'open');
    none.close();
    await close();
  });
  it('refuses requests addressed to another host name (DNS rebinding)', async () => {
    const { url, close } = await startServer({ port: 0, fresh: true, autosave: false });
    const port = new URL(url).port;
    const http = await import('node:http');
    const status = (path: string, method: string, host: string) => new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path, method, headers: { host, 'content-type': 'application/json' } }, (res) => { res.resume(); resolve(res.statusCode!); });
      req.on('error', reject); req.end(method === 'POST' ? '{}' : undefined);
    });
    expect(await status('/mcp', 'POST', `evil.example:${port}`)).toBe(403);
    expect(await status('/', 'GET', `evil.example:${port}`)).toBe(403);
    expect(await status('/', 'GET', `localhost:${port}`)).not.toBe(403);
    await close();
  });
});
