# Voice-controlled Pokémon Red Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a fork of `christianmat/jev-pokemon` into a local app where a player controls Pokémon Red by dictated or typed commands, direct controls, or an outside AI agent, with Jev choosing which currently possible action a command means.

**Architecture:** One Node process. A worker thread owns the emulator and runs the game in real time; it lists the currently possible actions and executes one at a time using the reference's (synchronous) navigation code. The main thread serves the web page over HTTP/WebSocket and an MCP endpoint, interprets text commands (fast path → Jev or a local stand-in), and sends questions to Claude. Stop and raw button input reach the worker through shared memory, so they work while an action is running.

**Tech Stack:** TypeScript, Node 20+, `tsx`, `serverboy` emulator, `ws`, `ai` (Vercel AI SDK, for Jev), `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, React + Vite (web), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-voice-pokemon-design.md`

## Global Constraints

- Repo root: `/Users/ryoiwata/Documents/projects/codeshop/jev-voice-pokemon`. GitHub: `ryoiwata/jev-voice-pokemon`, a public fork of `christianmat/jev-pokemon`. Licence stays GPL-2.0-or-later.
- ROM: `roms/red.gb`, SHA-1 `ea9bcae617fdf159b045185467ae58b2e4a48b9a`. Never committed. `roms/`, `vendor/`, `saves/`, `logs/`, `.env`, `src/data/generated.json`, `.superpowers/`, `web/dist/` are gitignored.
- The app never writes game memory. Buttons only.
- The app never chooses for the player: no strategy, no answering the game's own prompts, no changing game options at boot.
- Server binds `127.0.0.1` only. API keys are read server-side from `.env` and never sent to the page.
- Everything works with `JEV_MODE=mock` (the stand-in) and with no `ANTHROPIC_API_KEY`.
- Jev: model `typesafe-ai/jev`, at most 255 options per choice question, zero-data-retention gateway option kept.
- Thresholds (env, with defaults): `ACT_MIN_P=0.6`, `ACT_MIN_MARGIN=0.2`, `COSTLY_MIN_P=0.85`, `COSTLY_MIN_MARGIN=0.4`.
- Voice auto-send delay default 800 ms. Dialogue auto-advance on by default, pace default 1500 ms.
- Default keys in Controls mode: arrows, `Z`=A, `X`=B, `Enter`=START, `Shift`=SELECT. `Esc` = stop in every mode.
- Tests that need the ROM or a save-state fixture are skipped when it is absent (`describe.skipIf`). Fixtures live in `saves/fixtures/` and are never committed.
- Work on branch `voice-interface`. End commit messages with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Reference code is synchronous and blocking by design (`emu.press` advances frames in a loop). Keep it that way inside the worker; do not convert it to async.

## Review Focus

1. **Empty, whitespace-only or paragraph-long dictated text** → nothing runs, one log line, no crash. (Task 9, Task 10)
2. **A command arrives while nothing is possible** (cutscene, map transition, empty action list) → "can't do that right now", never a guess. (Task 9)
3. **The target is gone by the time the action runs** (an NPC walked off, the id is stale after the screen changed) → the action fails cleanly with a message and the game is left idle. (Task 6, Task 7)
4. **The browser tab closes or reloads while a direction key is held** → the held buttons are released, the character does not keep walking. (Task 3)
5. **Jev or Claude errors or times out mid-command** → Jev falls back to the stand-in for that command and says so; a failed answer logs one line; nothing hangs. (Task 9, Task 11)

## File Structure

```
src/emu/emulator.ts        keep; add control-block hook (Task 2)
src/emu/png.ts             keep
src/game/*                 keep (rom, state, symbols, text, world); regions.ts removed if unused
src/game/mode.ts           NEW  detectMode(ctx): Mode   (lifted from agent/agent.ts)
src/game/snapshot.ts       NEW  snapshot(ctx): GameSnapshot
src/jev/{client,gateway,types}.ts  keep
src/jev/standin.ts         NEW  word-matching JevBackend (replaces mock.ts)
src/actions/types.ts       NEW  Action, ActionResult, Ctx
src/actions/primitive.ts   NEW  press / steps / wait actions
src/actions/menu.ts        NEW  dialogue, menus, naming: list + run
src/actions/overworld.ts   NEW  from agent/overworld.ts: list + run, strategy removed
src/actions/battle.ts      NEW  from agent/battle.ts: list + run, strategy removed
src/actions/nav.ts         NEW  shared button helpers kept from agent/{menus,field,dialog,context}.ts
src/actions/index.ts       NEW  listActions(ctx), runAction(ctx, id, arg)
src/worker/control.ts      NEW  shared control block, StopError
src/worker/game-worker.ts  NEW  worker entry: game loop, auto-advance, RPC
src/server/game.ts         NEW  GameClient (main-thread proxy to the worker)
src/interpret/fastpath.ts  NEW  fixed grammar
src/interpret/interpreter.ts NEW Jev question + thresholds
src/answer/answerer.ts     NEW  Claude Q&A
src/server/session.ts      NEW  modes, command pipeline, log
src/server/mcp.ts          NEW  MCP tools
src/server/main.ts         REWRITE http + ws + mcp wiring
web/                       REWRITE Vite + React app
tests/                     NEW
REMOVED: src/agent/, src/knowledge/, src/stream/, src/jev/mock.ts, site/, scripts/og/, web/index.html (old)
```

---

### Task 1: Fork, set up, and prune to a compiling core

**Files:**
- Create: `vitest.config.ts`, `tests/helpers/rom.ts`, `tests/game/mode.test.ts`, `src/game/mode.ts`, `src/actions/types.ts`, `src/actions/nav.ts`
- Modify: `package.json`, `.gitignore`, `.env.example`, `scripts/setup.sh`, `README.md`
- Delete: `src/knowledge/`, `src/stream/`, `site/`, `scripts/og/`, `src/server/main.ts` body (replaced by a stub that boots the emulator and exits), `src/jev/mock.ts` (after Task 9; for now leave it)

**Interfaces:**
- Produces:
  - `type Mode = 'battle' | 'dialog' | 'overworld' | 'busy' | 'boot'`; `detectMode(ctx: Ctx): Mode` in `src/game/mode.ts` (same logic as `Agent.mode()` in the reference).
  - `interface Ctx { emu: Emulator; rom: Rom; gs: GameState; log(kind: string, msg: string): void; mem: NavMemory }` in `src/actions/types.ts`. `NavMemory` holds only the fields the kept navigation helpers still read (e.g. `trapSquares`, `dialog`); delete every strategy field.
  - `src/actions/nav.ts` re-exports the button helpers later tasks use: `tap`, `select`, `cursorTo`, `cursorToIndex`, `findLabel`, `confirmA`, `readMenuOptions`, `isPartyMenu`, `openStart`, `closeMenus`, `useFieldMove`, `useItem`, `typeName`, `isNamingScreen`, `advanceText`, `waitForChange`. Move their bodies here from `src/agent/{context,menus,field,dialog}.ts` unchanged, minus anything that calls Jev.
  - `tests/helpers/rom.ts`: `hasRom: boolean`; `hasFixture(name: string): boolean`; `boot(fixture?: string): Ctx` (new emulator from `roms/red.gb`, optionally `loadState('saves/fixtures/<name>.state.json')`).
  - `src/agent/overworld.ts` and `src/agent/battle.ts` stay in place, excluded from `tsconfig` (`"exclude": ["src/agent"]`), as source material for Tasks 7 and 8.

- [ ] **Step 1: Fork and clone into the existing folder**

```bash
gh repo fork christianmat/jev-pokemon --fork-name jev-voice-pokemon --clone=false
cd /Users/ryoiwata/Documents/projects/codeshop/jev-voice-pokemon
git init -b main && git remote add origin https://github.com/ryoiwata/jev-voice-pokemon.git
git remote add upstream https://github.com/christianmat/jev-pokemon.git
git fetch origin && git reset --mixed origin/main && git checkout -- . ':!docs'
git checkout -b voice-interface
```
Expected: `git status` shows only `docs/` and `.superpowers/` untracked.

- [ ] **Step 2: Commit the spec and plan, ignore `.superpowers/` and `web/dist/`**

```bash
printf '.superpowers/\nweb/dist/\n' >> .gitignore
git add .gitignore docs && git commit -m "docs: design and plan for the voice interface"
```

- [ ] **Step 3: Install and run the reference setup, place the ROM**

```bash
npm install && npm run setup
mkdir -p roms && unzip -p "../Pokemon - Red Version (UE)[!].zip" "Pokemon Red.gb" > roms/red.gb
shasum roms/red.gb   # expect ea9bcae617fdf159b045185467ae58b2e4a48b9a
```
Also add the SHA-1 check to `scripts/setup.sh` so it fails loudly on a wrong ROM.

- [ ] **Step 4: Add Vitest and the ROM helper; write the failing mode test**

`npm i -D vitest`; scripts `"test": "vitest run"`, `"typecheck": "tsc"`.

```ts
// tests/game/mode.test.ts
describe.skipIf(!hasRom)('detectMode', () => {
  it('is boot on a fresh emulator, then leaves boot after the title screen', () => {
    const ctx = boot();
    expect(detectMode(ctx)).toBe('boot');
    for (let i = 0; i < 40 && detectMode(ctx) === 'boot'; i++) ctx.emu.press('START', 6, 60);
    expect(['dialog', 'busy']).toContain(detectMode(ctx));
  });
});
```
Run: `npm test` → FAIL (`detectMode` not found).

- [ ] **Step 5: Create `mode.ts`, `types.ts`, `nav.ts`; delete the removed folders; stub `main.ts`**

`main.ts` for now: load ROM, construct `Emulator`, `Rom`, `GameState`, log `detectMode`, exit. Remove `STUCK_*`, `PLAYER_NAME`, `RIVAL_NAME`, stream keys from `.env.example`.

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm test` → both pass. Run: `git status --short | grep -E 'roms|saves|\.env$'` → no output.

- [ ] **Step 7: Commit** — `git commit -am "chore: prune reference to emulator, game reader and nav helpers"`

---

### Task 2: Game worker with real-time loop, stop, raw buttons and saves

**Files:**
- Create: `src/worker/control.ts`, `src/worker/game-worker.ts`, `src/server/game.ts`, `src/game/snapshot.ts`, `tests/worker/control.test.ts`, `tests/worker/game.test.ts`, `scripts/make-fixtures.ts`
- Modify: `src/emu/emulator.ts`

**Interfaces:**
- Produces (`src/worker/control.ts`):
  - `const enum Slot { STOP = 0, HELD = 1, AUTO_ADVANCE = 2, ADVANCE_PACE_MS = 3, SPEED_X100 = 4, RUNNING = 5 }`
  - `const BUTTON_BIT: Record<Button, number>` = `{ A:1, B:2, SELECT:4, START:8, RIGHT:16, LEFT:32, UP:64, DOWN:128 }`
  - `class Control { constructor(sab?: SharedArrayBuffer); readonly sab: SharedArrayBuffer; get(s: Slot): number; set(s: Slot, v: number): void; press(b: Button): void; release(b: Button): void; releaseAll(): void; heldButtons(): Button[] }`
  - `class StopError extends Error {}`
- Produces (`Emulator`): `attachControl(ctl: Control): void`. With a control attached, `frame()` (a) throws `StopError` if `STOP` is 1 and `RUNNING` is 1, (b) when `RUNNING` is 0, adds `ctl.heldButtons()` to the buttons held this frame.
- Produces (`src/game/snapshot.ts`):
  ```ts
  interface GameSnapshot {
    mode: Mode; map: string; x: number; y: number; facing: string;
    money: number; badges: number; pokedex: { seen: number; owned: number }; playTime: string;
    party: MonState[]; bag: { name: string; qty: number }[];
    battle: null | { kind: 'wild' | 'trainer'; enemy: { species: string; level: number; hp: number; maxHp: number; status: string } };
    dialog: string; running: null | { id: string; label: string };
  }
  function snapshot(ctx: Ctx): GameSnapshot
  ```
- Produces (`src/server/game.ts`), the only thing the rest of the server touches:
  ```ts
  class GameClient extends EventEmitter {
    static start(opts: { romPath: string; resume?: string }): Promise<GameClient>
    readonly ctl: Control
    state: GameSnapshot            // latest pushed by the worker
    actions: Action[]              // latest pushed by the worker ([] until Task 6)
    run(id: string, arg?: unknown): Promise<ActionResult>   // Task 6
    stop(): void                   // sets STOP; worker clears it when the action unwinds
    save(name: string): Promise<void>
    load(name: string): Promise<void>     // stops any running action first
    screenPng(): Promise<Buffer>
    shutdown(): Promise<void>      // autosave, terminate
    // events: 'frame'(Uint8Array rgba 160x144), 'audio'(Int16Array stereo interleaved), 'state', 'actions'
  }
  ```
- Worker behaviour: spawn with `new Worker(new URL('../worker/game-worker.ts', import.meta.url), { workerData: { sab, romPath, resume }, execArgv: ['--import', 'tsx'] })`. Idle loop runs frames at real time using the reference's fixed-timeline pacing (`Atomics.wait`), scaled by `SPEED_X100`, yielding to the worker's event loop with `setImmediate` every 4 frames so RPC messages are received. Posts `frame` every 2nd emulator slice, `state` at most 5×/s and only when `JSON.stringify(snapshot)` changed, `audio` in chunks of 2048 sample pairs (enable `enableAudioTap`). Autosaves to `saves/autosave.state.json` every 5 minutes and on `shutdown`. `resume` loads that file at start if present.

- [ ] **Step 1: Failing tests for `Control`**

```ts
it('press/release set and clear bits; heldButtons lists them', () => {
  const c = new Control(); c.press('A'); c.press('LEFT');
  expect(c.heldButtons().sort()).toEqual(['A', 'LEFT']);
  c.release('A'); expect(c.heldButtons()).toEqual(['LEFT']);
  c.releaseAll(); expect(c.get(Slot.HELD)).toBe(0);
});
it('shares state across instances on the same buffer', () => {
  const a = new Control(); const b = new Control(a.sab);
  a.set(Slot.STOP, 1); expect(b.get(Slot.STOP)).toBe(1);
});
```

- [ ] **Step 2: Implement `control.ts`; tests pass**

- [ ] **Step 3: Failing emulator-hook tests** (`describe.skipIf(!hasRom)`)

```ts
it('frame() throws StopError only while RUNNING', () => {
  const ctx = boot(); const ctl = new Control(); ctx.emu.attachControl(ctl);
  ctl.set(Slot.STOP, 1); expect(() => ctx.emu.frame()).not.toThrow();
  ctl.set(Slot.RUNNING, 1); expect(() => ctx.emu.frame()).toThrow(StopError);
});
```

- [ ] **Step 4: Implement `attachControl`; tests pass**

- [ ] **Step 5: Failing `GameClient` tests** (`skipIf(!hasRom)`, 20 s timeout)

```ts
it('emits frames and a state snapshot, and saves/loads', async () => {
  const g = await GameClient.start({ romPath: 'roms/red.gb' });
  const frame = await once(g, 'frame'); expect(frame[0].length).toBe(160 * 144 * 4);
  expect(g.state.mode).toBe('boot');
  await g.save('t-roundtrip'); await g.load('t-roundtrip');
  expect((await g.screenPng()).subarray(1, 4).toString()).toBe('PNG');
  await g.shutdown();
});
it('held buttons advance the game while idle', async () => {
  const g = await GameClient.start({ romPath: 'roms/red.gb' });
  g.ctl.set(Slot.SPEED_X100, 800);
  const t0 = Date.now();
  while (g.state.mode === 'boot' && Date.now() - t0 < 15000) { g.ctl.press('START'); await sleep(80); g.ctl.release('START'); await sleep(80); }
  expect(g.state.mode).not.toBe('boot');
  await g.shutdown();
});
```

- [ ] **Step 6: Implement `snapshot.ts`, `game-worker.ts`, `game.ts`; tests pass**

Pokédex seen uses `wPokedexSeen`; play time uses `wPlayTimeHours`/`wPlayTimeMinutes`.

- [ ] **Step 7: `scripts/make-fixtures.ts` (stage A)**

Using `boot()` and raw `emu.press`, from power-on: press START/A until a text box is waiting → save `fx-dialog`; continue to the player-name menu (cursor visible, options include `NEW NAME`) → save `fx-menu`; choose the first preset names and advance until `detectMode === 'overworld'` in `REDS_HOUSE_2F` → save `fx-bedroom`. Each stage loops on game state with a frame cap and throws if the cap is hit.
Run: `npx tsx scripts/make-fixtures.ts` → prints the three fixture names.

- [ ] **Step 8: Commit** — `feat: game worker with real-time loop, stop flag, raw buttons, saves`

---

### Task 3: Server, WebSocket protocol and a playable page

**Files:**
- Create: `src/server/main.ts` (rewrite), `src/server/wire.ts`, `web/` Vite React app (`web/package.json`, `web/vite.config.ts`, `web/index.html`, `web/src/{main.tsx,App.tsx,ws.ts,GameCanvas.tsx,Gamepad.tsx,PartyPanel.tsx,BattlePanel.tsx,BagPanel.tsx,keys.ts,styles.css}`), `tests/server/wire.test.ts`, `web/src/keys.test.ts`
- Modify: `package.json` (scripts `start`, `dev`, `build:web`)

**Interfaces:**
- Produces (`src/server/wire.ts`), shared by server and page:
  ```ts
  // binary frames, first byte is the tag
  const TAG_FRAME = 1;  // + 92160 bytes RGBA
  const TAG_AUDIO = 2;  // + Int16 LE interleaved stereo, 44100 Hz nominal
  type ServerMsg =
    | { type: 'state'; state: GameSnapshot }
    | { type: 'session'; mode: InputMode; autoAdvance: boolean; advancePaceMs: number; jev: 'standin' | 'gateway'; answers: boolean }
    | { type: 'log'; entry: LogEntry }          // Task 10
    | { type: 'saves'; names: string[] };
  type ClientMsg =
    | { type: 'down' | 'up'; button: Button }
    | { type: 'tap'; button: Button }            // on-screen gamepad click: held 100 ms
    | { type: 'stop' }
    | { type: 'save' | 'load'; name: string }
    | { type: 'text'; text: string }             // Task 10
    | { type: 'choose'; logId: string; index: number } // Task 10
    | { type: 'click'; col: number; row: number }      // Task 7
    | { type: 'set'; key: 'mode' | 'autoAdvance' | 'advancePaceMs' | 'speed'; value: unknown }; // Task 10
  type InputMode = 'voice' | 'text' | 'controls' | 'agent';
  function parseClientMsg(raw: string): ClientMsg | null   // null on anything malformed
  ```
- Server: `http` on `127.0.0.1:${PORT ?? 8787}`, serves `web/dist`, `ws` on the same server. On socket close: `ctl.releaseAll()`. SIGINT → `game.shutdown()`.
- Start-up flags: by default the game resumes `saves/autosave.state.json` if it exists; `--fresh` starts from power-on; `--load <name>` loads `saves/<name>.state.json` (so `--load fixtures/fx-bedroom` loads a fixture). `GameClient.start`'s `resume` takes the same `<name>` form.
- Page layout (two columns, per the approved mockup `layout-v2`): left = game canvas with volume control (wired in Task 4), controls strip, log (Task 10); right = Party, Battle (only when `state.battle`), Bag & trainer. There is no "what you can do" list.
- `web/src/keys.ts`: `DEFAULT_KEYMAP: Record<string, Button>` = `{ ArrowUp:'UP', ArrowDown:'DOWN', ArrowLeft:'LEFT', ArrowRight:'RIGHT', z:'A', x:'B', Enter:'START', Shift:'SELECT' }`; `buttonFor(e: {key: string}, map): Button | null` (case-insensitive for letters).

- [ ] **Step 1: Failing tests**

```ts
// tests/server/wire.test.ts
expect(parseClientMsg('{"type":"down","button":"A"}')).toEqual({ type: 'down', button: 'A' });
expect(parseClientMsg('{"type":"down","button":"TURBO"}')).toBeNull();
expect(parseClientMsg('not json')).toBeNull();
// web/src/keys.test.ts
expect(buttonFor({ key: 'Z' }, DEFAULT_KEYMAP)).toBe('A');
expect(buttonFor({ key: 'q' }, DEFAULT_KEYMAP)).toBeNull();
```

- [ ] **Step 2: Implement `wire.ts` and `keys.ts`; tests pass**

- [ ] **Step 3: Failing server test (Review Focus 4)** (`skipIf(!hasRom)`)

```ts
it('releases held buttons when the socket closes', async () => {
  const { game, url, close } = await startServer({ port: 0 });
  const ws = new WebSocket(url); await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'down', button: 'LEFT' })); await sleep(100);
  expect(game.ctl.heldButtons()).toEqual(['LEFT']);
  ws.close(); await sleep(100);
  expect(game.ctl.heldButtons()).toEqual([]);
  await close();
});
```
`main.ts` exports `startServer(opts: { port: number; fresh?: boolean; load?: string }): Promise<{ game: GameClient; url: string; close(): Promise<void> }>` and calls it when run directly.

- [ ] **Step 4: Implement the server; test passes**

- [ ] **Step 5: Build the page**

Canvas draws `TAG_FRAME` with `putImageData` on a 160×144 canvas scaled by CSS with `image-rendering: pixelated`. Keyboard goes to the game only when no input element has focus (mode switching comes in Task 10; for now always Controls behaviour). Panels render from `state`. Use the `frontend-design` skill for the visual pass; keep the mockup's structure.

- [ ] **Step 6: Verify by hand**

Run: `npm run build:web && npm start`, open `http://127.0.0.1:8787`. Expected: game visible and running; arrows/Z/X/Enter and the on-screen gamepad drive it; Party and Bag panels fill in after the intro; Save then Load returns to the saved moment. Use the `run` skill to drive and screenshot it.

- [ ] **Step 7: Commit** — `feat: local server and playable web page with state panels`

---

### Task 4: Game sound in the browser

**Files:**
- Create: `web/src/audio.ts`, `web/src/VolumeControl.tsx`, `web/src/audio.test.ts`
- Modify: `web/src/ws.ts`, `web/src/App.tsx`, `src/server/main.ts` (forward `audio` events as `TAG_AUDIO`)

**Interfaces:**
- Produces: `class GameAudio { constructor(ctx?: AudioContext); push(int16Stereo: Int16Array): void; setVolume(v: number): void; setMuted(m: boolean): void; resume(): Promise<void>; readonly needsGesture: boolean }`. `push` schedules each chunk as an `AudioBuffer` at `max(ctx.currentTime + 0.05, lastEnd)`; if the queue is more than 0.4 s ahead it drops the chunk (keeps latency bounded). Pure helper: `nextStart(now: number, lastEnd: number): number | null` (null = drop).
- Volume and mute persist in `localStorage` (wrapped in try/catch).

- [ ] **Step 1: Failing test**

```ts
expect(nextStart(10, 9)).toBeCloseTo(10.05);     // underrun: restart with 50 ms lead
expect(nextStart(10, 10.2)).toBeCloseTo(10.2);   // contiguous
expect(nextStart(10, 10.5)).toBeNull();          // more than 0.4 s queued: drop
```

- [ ] **Step 2: Implement; test passes**

- [ ] **Step 3: Wire up; show "Click to enable sound" while `needsGesture`**

- [ ] **Step 4: Verify by hand** — music plays at the title screen without crackle for 60 s; mute and volume work; reloading the page restores the volume.

- [ ] **Step 5: Commit** — `feat: game audio in the browser`

---

### Task 5: Action types and primitive actions

**Files:**
- Create: `src/actions/primitive.ts`, `src/actions/index.ts`, `tests/actions/primitive.test.ts`
- Modify: `src/actions/types.ts`, `src/worker/game-worker.ts`, `src/server/game.ts`

**Interfaces:**
- Produces (`src/actions/types.ts`):
  ```ts
  type ActionKind = 'go' | 'door' | 'interact' | 'field' | 'item' | 'move' | 'switch' | 'run' | 'menu' | 'text' | 'name' | 'press' | 'steps' | 'tile';
  interface Action { id: string; kind: ActionKind; label: string; costly?: boolean; at?: { x: number; y: number }; distance?: number }
  type ActionResult =
    | { status: 'done'; message: string }
    | { status: 'prompt'; message: string }     // the game is now asking something
    | { status: 'interrupted'; message: string } // battle started, trainer saw you, path blocked
    | { status: 'stopped'; message: string }
    | { status: 'failed'; message: string };     // unknown/stale id, target gone
  ```
- Produces (`src/actions/index.ts`): `listActions(ctx: Ctx): Action[]` and `runAction(ctx: Ctx, id: string, arg?: unknown): ActionResult`. `runAction` re-lists, looks the id up, returns `failed: "That isn't possible any more."` if absent, otherwise dispatches by id prefix. It never throws except `StopError`.
- Primitive ids, always listed: `press:A` … `press:DOWN` (8), `steps:up|down|left|right` (arg: count 1–20, default 1; only in overworld), `wait` (60 frames).
- Worker: RPC `run` sets `RUNNING=1`, clears `STOP`, calls `runAction`, catches `StopError` → `{status:'stopped', message:'Stopped.'}`, then in `finally` sets `RUNNING=0`, `STOP=0`. While running, `snapshot.running = {id, label}`. A second `run` while one is running is rejected by `GameClient.run`, which first calls `stop()` and awaits the first to settle (new command replaces the old). The worker posts `actions` whenever `JSON.stringify(listActions(ctx).map(a => a.id))` changes while idle.

- [ ] **Step 1: Failing tests** (`skipIf(!hasFixture('fx-bedroom'))`)

```ts
it('lists the eight buttons and four step directions in the overworld', () => {
  const ids = listActions(boot('fx-bedroom')).map(a => a.id);
  expect(ids).toEqual(expect.arrayContaining(['press:A', 'press:START', 'steps:left', 'wait']));
});
it('steps moves the player that many tiles, or reports blocked', () => {
  const ctx = boot('fx-bedroom'); const x0 = ctx.gs.x;
  const r = runAction(ctx, 'steps:left', 2);
  expect(['done', 'interrupted']).toContain(r.status);
  if (r.status === 'done') expect(ctx.gs.x).toBe(x0 - 2);
});
it('an unknown id fails cleanly', () => {
  expect(runAction(boot('fx-bedroom'), 'npc:99').status).toBe('failed');
});
```
And through the worker:
```ts
it('stop ends a running action with status stopped', async () => {
  const g = await GameClient.start({ romPath: 'roms/red.gb', resume: 'fixtures/fx-bedroom' });
  const p = g.run('wait'); setTimeout(() => g.stop(), 100);
  expect((await p).status).toBe('stopped');
  expect(g.state.running).toBeNull();
  await g.shutdown();
});
```

- [ ] **Step 2: Implement; tests pass**
- [ ] **Step 3: Commit** — `feat: action model, primitive actions, stoppable execution`

---

### Task 6: Dialogue, menu and naming actions, plus auto-advance

**Files:**
- Create: `src/actions/menu.ts`, `tests/actions/menu.test.ts`
- Modify: `src/actions/index.ts`, `src/worker/game-worker.ts`

**Interfaces:**
- Consumes: `nav.ts` helpers (`readMenuOptions`, `cursorTo`, `cursorToIndex`, `confirmA`, `advanceText`, `typeName`, `isNamingScreen`).
- Produces: `listMenu(ctx): Action[]`, `runMenu(ctx, a: Action, arg?): ActionResult`.
  - `text:next` (kind `text`, label "Continue") when a text box is waiting for A.
  - `menu:<LABEL>` (kind `menu`, label = the option text) for each option of the on-screen menu, including scrolled-off entries of list menus (bag, shop, PC), read from game memory lists where the reference does so.
  - `name` (kind `name`, label "Type a name") on naming screens; arg: `{ text: string }`, uppercased, letters only, cut to the screen's limit (7 for player/rival, 10 for nicknames).
  - `costly: true` for options whose label is `TOSS` or `RELEASE`, and for every option while the dialogue text matches `/forget|toss|release|Would you like to SAVE|overwritten/i`.
  - After any menu action: return `prompt` if a menu or naming screen is showing, else `done`.
- Auto-advance (worker idle loop): when `AUTO_ADVANCE` is 1, mode is `dialog`, a text box is waiting for A, no cursor is on screen, and the dialogue text has been unchanged for `ADVANCE_PACE_MS`, tap A once. Never fires while `RUNNING`.

- [ ] **Step 1: Failing tests**

```ts
describe.skipIf(!hasFixture('fx-menu'))('menu actions', () => {
  it('lists the on-screen options', () => {
    const labels = listActions(boot('fx-menu')).filter(a => a.kind === 'menu').map(a => a.label);
    expect(labels).toContain('NEW NAME'); expect(labels.length).toBeGreaterThanOrEqual(4);
  });
  it('choosing NEW NAME opens the naming screen and returns prompt; name types it', () => {
    const ctx = boot('fx-menu');
    expect(runAction(ctx, 'menu:NEW NAME').status).toBe('prompt');
    expect(listActions(ctx).map(a => a.id)).toContain('name');
    runAction(ctx, 'name', { text: 'Ryo' });
    for (let i = 0; i < 600 && ctx.gs.playerName !== 'RYO'; i++) ctx.emu.frame();
    expect(ctx.gs.playerName).toBe('RYO');
  });
  it('a stale menu id fails without pressing anything (Review Focus 3)', () => {
    const ctx = boot('fx-bedroom'); const f0 = ctx.emu.frames;
    expect(runAction(ctx, 'menu:YES').status).toBe('failed');
    expect(ctx.emu.frames).toBe(f0);
  });
});
describe.skipIf(!hasFixture('fx-dialog'))('text', () => {
  it('text:next advances the dialogue', () => {
    const ctx = boot('fx-dialog'); const before = ctx.gs.screen().dialog;
    runAction(ctx, 'text:next'); expect(ctx.gs.screen().dialog).not.toBe(before);
  });
});
```
Auto-advance, through the worker with `fx-dialog`, `SPEED_X100=800`, `ADVANCE_PACE_MS=200`: dialogue text changes within 3 s with no input; with `AUTO_ADVANCE=0` it does not.

- [ ] **Step 2: Implement; tests pass**
- [ ] **Step 3: Commit** — `feat: dialogue, menu and naming actions; dialogue auto-advance`

---

### Task 7: Overworld actions and click-to-go

**Files:**
- Create: `src/actions/overworld.ts`, `tests/actions/overworld.test.ts`
- Modify: `src/actions/index.ts`, `src/server/main.ts` (handle `click`), `web/src/GameCanvas.tsx`, `scripts/make-fixtures.ts`
- Delete when done: `src/agent/overworld.ts`, `src/game/regions.ts` if nothing imports it

**Interfaces:**
- Consumes: `src/agent/overworld.ts` as source. Keep its target discovery, `walk`, `face`, `waitWalkDone`, `interactGoal`, `blockedSquares`, and the per-kind execution in `execute`. Remove: every "fact" string, milestones, regions/route hints, intents, `grass` and `explore` candidates, `triedNoProgress`, loop protection, `pendingTarget` resumption, boulder-puzzle bookkeeping, anything reading `ctx.jev`.
- Produces: `listOverworld(ctx): Action[]`, `runOverworld(ctx, a: Action): ActionResult`, `tileAction(ctx, col: number, row: number): string | null`.
  - ids and labels: `npc:<index>` "Talk to <NAME>" (or "Pick up item" for item balls, "Examine <thing>" for objects); `sign:<x>,<y>` "Read sign"; `hidden:<x>,<y>` e.g. "Use the PC"; `warp:<x>,<y>` "Enter <DEST MAP>"; `exit:<dir>` "Go <dir> to <MAP>"; `cut:<x>,<y>`, `surf:<x>,<y>`, `strength`, `push:<x>,<y>:<dir>`; `start` "Open the menu"; `item:<NAME>` "Use <NAME>". Each positional action sets `at` and `distance` (path length). Unreachable targets are not listed. Sorted by `distance`.
  - Where two targets would share a label ("Talk to YOUNGSTER" twice), append a compass hint from the player ("… to the north") so labels are unique.
  - `tile:<x>,<y>` is not listed; `runAction` accepts it directly: walk to that map tile; `failed: "Can't get there."` if no path.
  - Results: `done` on arrival/interaction with no prompt; `prompt` if a text box or menu is showing afterwards; `interrupted` with a reason when a battle starts ("A wild battle started."), a trainer engages, or the walk is blocked after one replan ("Something is in the way.").
- `tileAction`: screen is 10 columns × 9 rows of 16 px tiles with the player at column 4, row 4, so map tile = `(gs.x + col - 4, gs.y + row - 4)`. Returns the id of the listed action whose `at` matches, else `tile:<x>,<y>`. Returns null outside `overworld` mode. Server: on `click`, compute it and run it via the session (Task 10; until then call `game.run` directly).

- [ ] **Step 1: Failing tests** (`skipIf(!hasFixture('fx-bedroom'))`)

```ts
it('lists the stairs and the PC in the bedroom, nearest first, with no strategy text', () => {
  const acts = listActions(boot('fx-bedroom')).filter(a => ['door', 'interact', 'go'].includes(a.kind));
  expect(acts.some(a => a.id.startsWith('warp:') && /REDS_HOUSE_1F|Red's house/i.test(a.label))).toBe(true);
  expect(acts.some(a => /PC/.test(a.label))).toBe(true);
  expect(acts.map(a => a.distance)).toEqual([...acts.map(a => a.distance)].sort((p, q) => p! - q!));
  expect(acts.every(a => !/objective|toward|areas\)/i.test(a.label))).toBe(true);
});
it('taking the stairs changes the map', () => {
  const ctx = boot('fx-bedroom'); const id = listActions(ctx).find(a => a.id.startsWith('warp:'))!.id;
  expect(runAction(ctx, id).status).toBe('done'); expect(ctx.gs.mapName).toBe('REDS_HOUSE_1F');
});
it('using the PC ends in a prompt', () => {
  const ctx = boot('fx-bedroom'); const id = listActions(ctx).find(a => /PC/.test(a.label))!.id;
  expect(runAction(ctx, id).status).toBe('prompt');
});
it('tileAction maps a click on a thing to its action and bare floor to a tile walk', () => {
  const ctx = boot('fx-bedroom'); const pc = listActions(ctx).find(a => /PC/.test(a.label))!;
  expect(tileAction(ctx, pc.at!.x - ctx.gs.x + 4, pc.at!.y - ctx.gs.y + 4)).toBe(pc.id);
  expect(tileAction(ctx, 4, 4)).toBe(`tile:${ctx.gs.x},${ctx.gs.y}`);
});
it('an unreachable tile fails cleanly', () => {
  expect(runAction(boot('fx-bedroom'), 'tile:200,200').status).toBe('failed');
});
```

- [ ] **Step 2: Implement; tests pass**

- [ ] **Step 3: Extend `make-fixtures.ts` (stage B)**

Using `listActions`/`runAction` only: from `fx-bedroom` go downstairs, leave the house, walk `exit:up` out of Pallet Town until Oak intercepts, advance to Oak's lab with the three Poké Balls on the table → save `fx-lab`; pick up a ball and confirm → continue until the rival battle's main menu shows → save `fx-battle`. Frame caps and thrown errors as in stage A.
Run: `npx tsx scripts/make-fixtures.ts` → prints five fixture names. (This run is also the first end-to-end check of Tasks 5–7.)

- [ ] **Step 4: Wire the canvas click; verify by hand** — clicking the stairs walks there and goes down; clicking a wall logs "Can't get there."

- [ ] **Step 5: Commit** — `feat: overworld actions and click-to-go`

---

### Task 8: Battle actions

**Files:**
- Create: `src/actions/battle.ts`, `tests/actions/battle.test.ts`
- Modify: `src/actions/index.ts`
- Delete when done: `src/agent/` (whole folder), the `tsconfig` exclude

**Interfaces:**
- Consumes: `src/agent/battle.ts` as source: keep `isMainMenu`, `waitForBag`, `waitForPartyPick`, `gs_isSafari`, and the button sequences inside the `actions[key] = …` closures. Remove damage estimates, catch-chance text, focus/intent logic, and every option filter that hides a legal choice (the player may pick a no-effect move).
- Produces: `listBattle(ctx): Action[]`, `runBattle(ctx, a): ActionResult`. Listed only at the battle main menu; otherwise the battle falls through to `listMenu` (party pick, move-forget, nickname prompt, text).
  - `move:<NAME>` "Use <NAME>" for each move, including 0-PP moves; `ball:<NAME>` "Throw <NAME>" (wild battles only); `item:<NAME>` "Use <NAME>" for other bag items; `switch:<slot>` "Switch to <NICKNAME>" for each other non-fainted party member; `run` "Run away". Safari: `menu:` entries for its four options.
  - `costly: true` on `ball:MASTER BALL`.
  - `item:<NAME>` selects the item and stops when the game asks which Pokémon: returns `prompt`. `ball:` and `move:` return `done` once the turn's text starts, or `prompt`/`failed` ("No PP left for <NAME>.") as the game reports.

- [ ] **Step 1: Failing tests** (`skipIf(!hasFixture('fx-battle'))`)

```ts
it('lists the active Pokémon’s moves and no ball or run in a trainer battle', () => {
  const ctx = boot('fx-battle'); const acts = listActions(ctx);
  const moves = ctx.gs.party()[0].moves.map(m => `move:${m.name}`);
  expect(acts.map(a => a.id)).toEqual(expect.arrayContaining(moves));
  expect(acts.some(a => a.kind === 'run' || a.id.startsWith('ball:'))).toBe(false);
});
it('using a move spends its PP', () => {
  const ctx = boot('fx-battle'); const m = ctx.gs.party()[0].moves[0];
  expect(runAction(ctx, `move:${m.name}`).status).toBe('done');
  for (let i = 0; i < 900 && ctx.gs.party()[0].moves[0].pp === m.pp; i++) ctx.emu.frame();
  expect(ctx.gs.party()[0].moves[0].pp).toBe(m.pp - 1);
});
```
A wild-battle fixture (`fx-wild`, made by extending stage B: win the rival battle, walk into Route 1 grass with `steps:` until a battle starts) backs:
```ts
it.skipIf(!hasFixture('fx-wild'))('run ends a wild battle', () => {
  const ctx = boot('fx-wild'); runAction(ctx, 'run');
  for (let i = 0; i < 900 && ctx.gs.inBattle; i++) { if (ctx.gs.screen().waitingForA) ctx.emu.press('A'); else ctx.emu.frame(); }
  expect(ctx.gs.inBattle).toBe(0);
});
```
Ball throwing has no fixture (no balls this early); it is verified by hand in Task 13.

- [ ] **Step 2: Implement; tests pass; delete `src/agent/`; `npm run typecheck` passes**
- [ ] **Step 3: Commit** — `feat: battle actions; remove reference agent`

---

### Task 9: Fast path, stand-in and interpreter

**Files:**
- Create: `src/interpret/fastpath.ts`, `src/interpret/interpreter.ts`, `src/jev/standin.ts`, `tests/interpret/{fastpath,standin,interpreter}.test.ts`
- Modify: `src/jev/client.ts` (use `StandinJev` for `mock`; drop `explore`/`sample`; add `timeoutMs`), delete `src/jev/mock.ts`

**Interfaces:**
- Produces (`fastpath.ts`):
  ```ts
  type Fast =
    | { kind: 'stop' }
    | { kind: 'set'; key: 'mode'; value: InputMode } | { kind: 'set'; key: 'autoAdvance'; value: boolean }
    | { kind: 'save' } | { kind: 'load' }
    | { kind: 'run'; id: string; arg?: unknown }       // press:X, steps:dir (+count), text:next, name (+text)
    | { kind: 'pick'; index: number };                 // answer to a pending "did you mean"
  function fastPath(text: string, has: (id: string) => boolean, pending: boolean): Fast | null
  ```
  Grammar (case-insensitive, trailing punctuation ignored): `stop|halt|cancel` → stop. `(voice|text|controls|agent) mode`. `save` / `load`. `auto advance (on|off)`. `(press )?(a|b|start|select)`. `(go |walk |move )?(up|down|left|right)( (\d+|one..twenty)( steps?)?)?` → `steps:` when `has('steps:<dir>')`, else `press:<DIR>`. `next|continue|okay|ok` → `text:next` when `has`. `(name|call) (it|him|her|them|me )?(.+)` → `name` when `has('name')`. With `pending`: `(one|two|three|1|2|3|first|second|third)( one)?` → pick. Anything else → null.
- Produces (`standin.ts`): `class StandinJev implements JevBackend { name = 'standin' }`. For a `choice` question whose `state` has a string `said`: normalise both sides (lowercase, `é`→`e`, drop non-alphanumerics, join `poke ball`→`pokeball`, drop the words `the a an to with my please`), score each option by the share of its label tokens found in `said` (a token matches on equality or edit distance ≤ 1 for tokens of 5+ letters), `__question` scores 1 if `said` ends in `?` or starts with `what|why|how|who|where|when|which|is|are|does|do|can|should`, `__impossible` scores a flat 0.3. Probabilities = score² / Σ score². Other question types return neutral answers.
- Produces (`interpreter.ts`):
  ```ts
  type Interpretation =
    | { kind: 'act'; action: Action; p: number }
    | { kind: 'question' }
    | { kind: 'impossible' }
    | { kind: 'clarify'; options: Action[] }           // up to 3
    | { kind: 'nothing'; reason: 'empty' | 'busy' };
  class Interpreter {
    constructor(jev: Jev, fallback: JevBackend, th?: Partial<Thresholds>)
    interpret(said: string, actions: Action[], state: GameSnapshot): Promise<Interpretation & { backend: string; fellBack: boolean }>
  }
  ```
  Rules: trimmed `said` empty → `nothing/empty`. `said` longer than 200 chars is cut to 200. No actions other than `press:`/`wait` → `nothing/busy`. Candidates = all actions except `press:*`, `steps:*`, `wait`; if more than 253, keep the 253 with the smallest `distance` (undefined = 0). One Jev `choice` question `intent`, criteria = `{ [id]: label }` plus `__question: "The player is asking a question, not giving a command"` and `__impossible: "The player wants something that none of the other options does"`; state = `{ said, situation: mode, place: map, onScreenText: dialog, party: nicknames }`. Top = `__question` → question; `__impossible` → impossible; else `act` when `p ≥ minP && p − p2 ≥ minMargin` (the `COSTLY_*` pair when `action.costly`), else `clarify` with the top 3 real actions. If the Jev call throws or exceeds `JEV_TIMEOUT_MS` (default 4000), repeat once on `fallback` and set `fellBack: true`.

- [ ] **Step 1: Failing fast-path tests**

```ts
const has = (id: string) => ['steps:left', 'text:next', 'name'].includes(id);
expect(fastPath('Stop.', has, false)).toEqual({ kind: 'stop' });
expect(fastPath('left three', has, false)).toEqual({ kind: 'run', id: 'steps:left', arg: 3 });
expect(fastPath('up', has, false)).toEqual({ kind: 'run', id: 'press:UP' });
expect(fastPath('press A', has, false)).toEqual({ kind: 'run', id: 'press:A' });
expect(fastPath('name him Sparky', has, false)).toEqual({ kind: 'run', id: 'name', arg: { text: 'Sparky' } });
expect(fastPath('agent mode', has, false)).toEqual({ kind: 'set', key: 'mode', value: 'agent' });
expect(fastPath('the second one', has, true)).toEqual({ kind: 'pick', index: 1 });
expect(fastPath('two', has, false)).toBeNull();
expect(fastPath('walk to the poke ball', has, false)).toBeNull();
```

- [ ] **Step 2: Implement `fastpath.ts`; pass**

- [ ] **Step 3: Failing stand-in and interpreter tests** (no ROM; hand-written action lists)

```ts
const A = (id: string, label: string, extra = {}) => ({ id, kind: 'interact', label, ...extra }) as Action;
const acts = [A('npc:1', 'Pick up item'), A('npc:2', 'Talk to YOUNGSTER to the north'), A('npc:3', 'Talk to YOUNGSTER to the east'),
              A('ball:ULTRA BALL', 'Throw ULTRA BALL'), A('ball:MASTER BALL', 'Throw MASTER BALL', { costly: true }), A('press:A', 'A')];
const I = new Interpreter(new Jev({ mode: 'mock' }), new StandinJev());
expect((await I.interpret('catch with ultra ball', acts, S)).kind).toBe('act');            // → ball:ULTRA BALL
expect((await I.interpret('talk to the youngster', acts, S)).kind).toBe('clarify');
expect((await I.interpret("what's good against rock types?", acts, S)).kind).toBe('question');
expect((await I.interpret('fly to cerulean city', acts, S)).kind).toBe('impossible');
expect((await I.interpret('   ', acts, S))).toMatchObject({ kind: 'nothing', reason: 'empty' });      // Review Focus 1
expect((await I.interpret('x'.repeat(5000), acts, S)).kind).not.toBe('act');                          // Review Focus 1
expect((await I.interpret('use ember', [A('press:A', 'A')], S))).toMatchObject({ kind: 'nothing', reason: 'busy' }); // Review Focus 2
expect((await I.interpret('throw ball', acts, S)).kind).toBe('clarify');                   // costly never wins a near-tie
// Review Focus 5
const failing = new Interpreter(jevThatThrows(), new StandinJev());
expect(await failing.interpret('catch with ultra ball', acts, S)).toMatchObject({ kind: 'act', fellBack: true });
// More than 255 options is narrowed, not sent whole
const many = Array.from({ length: 400 }, (_, i) => A(`sign:${i},0`, `Read sign ${i}`, { distance: i }));
const spy = spyBackend(); await new Interpreter(new Jev({ backend: spy }), spy).interpret('read sign 3', many, S);
expect(Object.keys(spy.lastQuestion.criteria).length).toBeLessThanOrEqual(255);
```
`Jev`'s constructor gains an optional `backend` so tests can inject one.

- [ ] **Step 4: Implement `standin.ts`, `interpreter.ts`, the `Jev` client changes; pass**
- [ ] **Step 5: Commit** — `feat: command interpreter with fast path, Jev question and local stand-in`

---

### Task 10: Session: modes, command pipeline, log, and the command bar

**Files:**
- Create: `src/server/session.ts`, `tests/server/session.test.ts`, `web/src/{CommandBar.tsx,ModeSwitch.tsx,Log.tsx,Settings.tsx,useAutoSend.ts,useAutoSend.test.ts}`
- Modify: `src/server/main.ts`, `src/server/wire.ts`, `web/src/App.tsx`

**Interfaces:**
- Consumes: `GameClient`, `Interpreter`, `fastPath`, `Answerer` (Task 11; until then inject a stub `{ answer: async () => 'Question answering isn\'t set up.' }`).
- Produces:
  ```ts
  type Source = 'human' | 'agent';
  interface LogEntry { id: string; at: number; source: Source; heard?: string; status: 'running' | 'done' | 'failed' | 'stopped' | 'asking' | 'answer' | 'info'; text: string; choices?: { id: string; label: string }[] }
  class Session extends EventEmitter {           // emits 'log' (LogEntry, also on update of the same id) and 'session'
    constructor(deps: { game: GameClient; interpreter: Interpreter; answerer: AnswererLike })
    mode: InputMode                               // default 'voice'
    handleText(text: string, source: Source): Promise<ActionResult | { status: 'answer' | 'asking' | 'refused' | 'nothing'; message: string }>
    runAction(id: string, source: Source, arg?: unknown): Promise<ActionResult | { status: 'refused'; message: string }>
    choose(logId: string, index: number, source: Source): Promise<…same as runAction>
    rawButton(kind: 'down' | 'up' | 'tap', button: Button): void     // human only
    stop(source: Source): void                    // always allowed
    set(key: 'mode' | 'autoAdvance' | 'advancePaceMs' | 'speed', value: unknown): void
  }
  ```
- Rules:
  - `stop` from any source in any mode stops the running action.
  - `source === 'agent'` acting calls are `refused: "The player has the controls."` unless `mode === 'agent'`.
  - In `agent` mode, human `handleText` accepts only fast-path `stop`, `set mode` and `pick`; anything else → `refused: "Agent mode: say \"stop\" or \"voice mode\" to take over."`.
  - Any human `runAction`, `choose` or `rawButton` while an agent's action is running stops it first; the agent's pending promise resolves `{status:'interrupted', message:'Interrupted by the player.'}`.
  - `rawButton` while any action is running stops it first, then applies the button.
  - `handleText` pipeline: fast path → else `interpreter.interpret(text, game.actions, game.state)`:
    - `act` → log `running` with `"<label>"` (plus `" (N steps)"` when `distance`), `game.run`, update the same entry with the result message.
    - **Carry-over:** if that result is `prompt`, call `interpret` once more with the same text against the new `game.actions`, using the `COSTLY_*` thresholds for everything; if it yields `act`, run it too. Never more than one follow-up.
    - `clarify` → log `asking` with `choices`; remember them as pending. A later non-pick command clears pending.
    - `question` → `answerer.answer(text, game.state)`; log `answer`, streaming updates to the same entry.
    - `impossible` → log `failed`: `"I can only do things you can do from here."`
    - `nothing/empty` → no log entry. `nothing/busy` → log `failed`: `"Can't do that right now."`
    - `fellBack` → append `" (Jev unavailable, used the stand-in)"` to the entry.
- Web:
  - `useAutoSend(value: string, delayMs: number, enabled: boolean, send: (v: string) => void)`: when enabled and `value.trim()` is non-empty and unchanged for `delayMs`, call `send` once and clear.
  - `CommandBar`: in `voice` and `agent` modes the input is auto-focused, re-focused on blur, and uses `useAutoSend` (800 ms default, adjustable in Settings); in `text` mode Enter sends; in `controls` mode it is not focused and the keyboard goes to the game. `Esc` sends `stop` in every mode.
  - `Log`: newest at the bottom; `asking` entries render numbered buttons that send `choose`.
  - `ModeSwitch`: four buttons; reflects `session.mode` from the server so voice-initiated switches show.
  - Badge: "Jev: stand-in" / "Jev: live". Settings: auto-advance toggle and pace, voice send delay, speed, key mapping.

- [ ] **Step 1: Failing session tests** (fake `GameClient` with scripted `actions`/`run`; no ROM)

```ts
it('runs a clear command without asking and logs heard → running → done', …);
it('asks on an ambiguous command; "two" runs the second choice', …);
it('routes a question to the answerer and presses nothing', async () => {
  await s.handleText("what's good against rock types?", 'human');
  expect(game.run).not.toHaveBeenCalled(); expect(lastLog().status).toBe('answer');
});
it('refuses agent actions outside agent mode but lets agents stop', …);
it('in agent mode, human text other than stop/mode is refused', …);
it('a human click interrupts an agent action', …);
it('carry-over: "use potion on pikachu" runs item:POTION, then menu:PIKACHU from the prompt', …);
it('carry-over does not chain a second time', …);
it('empty text produces no log entry (Review Focus 1)', …);
it('"agent mode" and "voice mode" switch modes by voice', …);
```
```ts
// web/src/useAutoSend.test.ts (fake timers)
it('sends once after the value is stable for the delay', …);   // type "walk", wait 799 → not sent; wait 1 → sent "walk"
it('restarts the timer when the value changes', …);
it('never sends whitespace', …);
it('does nothing when disabled', …);
```
Each `…` body asserts two things: which ids the fake `game.run` was called with, in order (or that it was not called), and the sequence of `LogEntry.status` values emitted for that command. For the refusal tests, also assert the exact message strings from the Rules above.

- [ ] **Step 2: Implement `session.ts`; wire `text`, `choose`, `click`, `set`, `stop`, `tap/down/up` in `main.ts` to it; pass**
- [ ] **Step 3: Implement the web components; pass**
- [ ] **Step 4: Verify by hand with the stand-in**

From `fx-bedroom` (`npm start -- --load fixtures/fx-bedroom`): type "go downstairs"-style commands using on-screen names ("enter red's house 1f", "use the pc"), "left 2", "stop" during a long walk (halts within a step), "agent mode" then "voice mode". In Voice mode, pasted text sends itself after ~0.8 s with no Enter.

- [ ] **Step 5: Commit** — `feat: session with input modes, command pipeline, log and command bar`

---

### Task 11: Answering questions with Claude

**Files:**
- Create: `src/answer/answerer.ts`, `tests/answer/answerer.test.ts`
- Modify: `src/server/main.ts`, `.env.example`, `package.json`

**Interfaces:**
- Produces: `interface AnswererLike { answer(question: string, state: GameSnapshot, onDelta?: (soFar: string) => void): Promise<string> }`; `class Answerer implements AnswererLike { constructor(opts?: { apiKey?: string; model?: string; client?: AnthropicLike }) ; readonly enabled: boolean }`; `function gameContext(state: GameSnapshot): string`.
- Model from `ANSWER_MODEL`, default `claude-sonnet-5-5`; `max_tokens` 400; streaming. System prompt: the assistant answers questions about Pokémon Red (Generation 1 rules) for a player mid-game, in at most four short sentences of plain text, using the supplied game state, and never claims to have done anything in the game.
- No key → `enabled === false` and `answer` resolves `"Question answering isn't set up. Add ANTHROPIC_API_KEY to .env."`. API error or 20 s timeout → resolves `"Couldn't get an answer just now."` (never rejects).
- Invoke the `claude-api` skill before writing the SDK call.

- [ ] **Step 1: Failing tests** (fake client; no network)

```ts
expect(gameContext(S)).toContain('SQUIRT'); expect(gameContext(S)).toContain('VIRIDIAN_CITY');
expect(await new Answerer({ apiKey: '' }).answer('hi?', S)).toMatch(/isn't set up/);
expect(await new Answerer({ apiKey: 'k', client: throwingClient }).answer('hi?', S)).toBe("Couldn't get an answer just now."); // Review Focus 5
const deltas: string[] = []; await new Answerer({ apiKey: 'k', client: streamingClient(['Wa', 'ter']) }).answer('q?', S, d => deltas.push(d));
expect(deltas).toEqual(['Wa', 'Water']);
```

- [ ] **Step 2: Implement; pass. Replace the Task 10 stub in `main.ts`.**
- [ ] **Step 3: Commit** — `feat: answer questions with Claude`

---

### Task 12: MCP door for other agents

**Files:**
- Create: `src/server/mcp.ts`, `tests/server/mcp.test.ts`
- Modify: `src/server/main.ts`, `package.json`

**Interfaces:**
- Consumes: `Session`, `GameClient`.
- Produces: `mountMcp(server: http.Server, deps: { session: Session; game: GameClient }): void` serving MCP over streamable HTTP at `/mcp` (stateless), using `@modelcontextprotocol/sdk`.
- Tools (names exact): `get_state` → `GameSnapshot` plus `inputMode`; `get_screen` → PNG image content; `list_actions` → `Action[]`; `do_action {id, arg?}`; `send_command {text}`; `ask {text}` → answer text; `press {buttons: Button[]}` (each tapped in order, max 20); `stop`; `save_state {name}`; `load_state {name}`. `name` must match `/^[a-z0-9_-]{1,40}$/i`. Every acting tool goes through `Session` with `source: 'agent'`, so refusals carry the session's message as a non-error text result with `isError: true`.

- [ ] **Step 1: Failing tests** (SDK client against `startServer({port: 0})`; `skipIf(!hasFixture('fx-bedroom'))`)

```ts
it('lists the ten tools', …);                                   // exact names above
it('reads state and actions in any mode', …);                   // mode 'voice': get_state, list_actions succeed
it('refuses do_action outside agent mode', …);                  // isError, text "The player has the controls."
it('acts in agent mode and returns the outcome', …);            // set mode agent; do_action steps:left → status in result
it('stop works in any mode', …);
it('rejects a save name with a path in it', …);                 // "../x" → isError
```

- [ ] **Step 2: Implement; pass**
- [ ] **Step 3: Commit** — `feat: MCP endpoint for outside agents`

---

### Task 13: Docs, real-Jev readiness, acceptance run, push

**Files:**
- Modify: `README.md`, `.env.example`, `package.json` (name `jev-voice-pokemon`, description, author kept in credits)

- [ ] **Step 1: Rewrite `README.md`**

Sections: what it is and who it's for; credit ("Fork of christianmat/jev-pokemon by Christian Mathiesen; this fork replaces autonomous play with a command interface") and what changed; setup (Node 20+, `npm install`, `npm run setup`, own ROM at `roms/red.gb` with the SHA-1, `.env`); running (`npm start`, `--fresh`, `--load <name>`); the four input modes; Wispr Flow setup (focus stays in the command box, dictate, text sends itself; one hotkey hold per command; suggest adding Pokémon names to Wispr Flow's dictionary); connecting an agent (`/mcp` URL, tool list, Agent mode); keys and costs (`AI_GATEWAY_API_KEY`, `JEV_MODE=gateway`, `ANTHROPIC_API_KEY`, `ANSWER_MODEL`, thresholds); Legal section kept from the reference.

- [ ] **Step 2: Whole-suite check**

Run: `npm run typecheck && npm test && npm run build:web` → all pass. Run: `git ls-files | grep -Ei '\.gb$|saves/|\.env$|generated\.json'` → no output.

- [ ] **Step 3: Acceptance run on the stand-in** (by hand or with the `run` skill, from `--fresh`)

Check and record each: sound plays; Controls mode keys and gamepad work; in Voice mode, typed-and-left-alone text sends itself; dialogue auto-advances and stops at choices; "walk to"/"enter"/"talk to" commands using on-screen names work; clicking the game screen walks; "stop" halts a walk within a step; a question produces text and no button presses (or the "isn't set up" line without a key); an MCP client can read in any mode and act only in Agent mode; with at least one Poké Ball in a wild battle, "throw poke ball" opens the bag and throws it.

- [ ] **Step 4: Note what waits for the Jev key**

In the README under "Status": the spec's three *(Jev)* checks (declining "go to Cerulean City", asking on "talk to him", a full voice-only run through the first rival battle) are to be judged after `JEV_MODE=gateway` is set, followed by tuning `ACT_MIN_P`/`ACT_MIN_MARGIN` from `logs/jev-calls.jsonl`.

- [ ] **Step 5: Commit and push the branch**

```bash
git commit -am "docs: README for the voice interface" && git push -u origin voice-interface
```
Then use superpowers:finishing-a-development-branch to decide how it lands on `main`.
