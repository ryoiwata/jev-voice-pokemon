# Page Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the page around a drawn GBA-shaped console whose buttons move with the game, a two-position Voice/Text switch, a three-step "what's happening" strip, and a sidebar with pictures decoded from the player's ROM.

**Architecture:** Server changes are small and come first: two modes with agents always allowed, a buttons byte on every frame message, two extra fields on log entries, three extra snapshot fields, and a picture decoder behind two HTTP routes. The page is then rebuilt in three slices (console, command area, sidebar) on top of small pure modules that carry all the logic and all the unit tests; components stay thin.

**Tech Stack:** TypeScript, Node worker threads, `ws`, React 19, Vite, Vitest. New: `@fontsource/atkinson-hyperlegible-next`, `@fontsource/pixelify-sans`.

**Spec:** `docs/superpowers/specs/2026-11-12-ui-overhaul-design.md`. Visual reference: `docs/superpowers/specs/2026-11-12-ui-overhaul-mockup.html` (copy its CSS tokens and component styles; it is the agreed look).

## Global Constraints

- No Nintendo art, logo or name in the repo. Decoded pictures live in memory only; nothing decoded is written to disk. The console's wordmark reads "VOICE BOY".
- The app only presses buttons; it never writes game memory.
- Player always beats agent: the existing refusal and take-over rules stay exactly as they are.
- Esc always stops the game, whatever is open or focused.
- No outside network requests from the page (fonts are bundled).
- Tokens: desk `#dcd9ea`, paper `#f8f7fc`, ink `#1c1a3a`, indigo `#4a3fb0`, red `#d8342c`, pressed `#ffd23f`. Atkinson Hyperlegible Next for all read text and all numbers; Pixelify Sans only for names and section headings.
- Breakpoints: one column below 940 px; smaller wings below 560 px, screen at least 60% of the console's width.
- Motion: only button presses and the listening dot; none under `prefers-reduced-motion`.
- ROM-dependent tests skip without the ROM (`hasRom` / `hasFixture` from `tests/helpers/rom.ts`).
- Work on `main`; after each task run `npm run typecheck && npm test`, commit, and `git push origin main` (the owner's standing rule; never push to `upstream`, no pull requests).
- Commit messages end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. A tap at 4× speed, where most frames are never sent: the console button must still show. (Test in Task 2.)
2. A stale page or old client sending `{type:'set', key:'mode', value:'agent'}`: rejected as malformed, mode unchanged, no crash. (Test in Task 1.)
3. A species whose name is awkward in a URL (`MR.MIME`, `FARFETCH'D`, `NIDORAN♂`): the picture route resolves it; a name with `/` or `..` is a 404, never a file read. (Test in Task 5.)
4. The player holds a page button while a command's frames arrive with that bit clear (during an action, held buttons are ignored by the emulator): the button still shows pressed locally and does not flicker. (Test in Task 6.)
5. A log entry finishing while the strip's 4-second linger runs, then a new command starting: the strip switches to the new command at once, never shows the old "chose" with the new "said". (Test in Task 6.)

---

## File Structure

| File | Responsibility |
|---|---|
| `src/server/wire.ts` | two modes; `buttonMask`/`maskButtons`; `chose`, `sure` on `LogEntry` |
| `src/emu/emulator.ts` | `onFrame` also reports the buttons held that frame |
| `src/worker/game-worker.ts` | union of held buttons per sent frame, prefixed to the frame |
| `src/server/session.ts` | no agent gate, stop hold-off, `chose`/`sure` |
| `src/game/pics.ts` (new) | `Pics` class: decode front pictures to PNG |
| `src/server/main.ts` | `/pic/...` routes |
| `src/game/snapshot.ts` | `playerName`, `badgeList`, `battle.slot` |
| `web/src/pressed.ts` (new) | pressed-button state and the key trail |
| `web/src/lane.ts` (new) | which command-area view to show |
| `web/src/itemIcon.ts` (new) | item name → icon kind |
| `web/src/words.ts` (new) | `pretty`, status words, facing words, badge names |
| `web/src/Console.tsx` (new) | the handheld: shell, screen (uses `GameCanvas`), buttons |
| `web/src/CommandArea.tsx` (new) | switch, box, Stop, strip/ask/answer/idle, Earlier |
| `web/src/TopBar.tsx` (new) | name, Jev status, Sound/Saves/Settings panels |
| `web/src/Sidebar.tsx` (new) | battle banner, party, trainer card, bag |
| `web/src/styles.css` | rewritten from the mockup |
| deleted | `web/src/Gamepad.tsx`, `ModeSwitch.tsx`, `panels.tsx`, `Log.tsx`, `Settings.tsx`, `VolumeControl.tsx` (their behaviour moves into the new components) |

---

### Task 1: Two modes, agents always allowed, stop hold-off

**Files:**
- Modify: `src/server/wire.ts`, `src/server/session.ts`, `src/interpret/fastpath.ts`, `src/server/mcp.ts`
- Test: `tests/server/wire.test.ts`, `tests/server/session.test.ts`, `tests/interpret/fastpath.test.ts`, `tests/server/mcp.test.ts`

**Interfaces:**
- Produces: `type InputMode = 'voice' | 'text'`; `INPUT_MODES = ['voice','text']`; `Session.AGENT_HOLD_MS = 5000` (static); `Session` constructor deps gain optional `now?: () => number` (default `Date.now`) for tests.

- [ ] **Step 1: Rewrite the failing tests**

In `tests/server/session.test.ts`, replace the agent-mode tests (lines ~159–183 and ~330) with:

```ts
it('lets an agent act in any mode when the player is idle', async () => {
  const { session } = make();                       // existing helper; mode starts 'voice'
  const r = await session.runAction('press:A', 'agent');
  expect(r.status).not.toBe('refused');
});
it('holds agents off for 5 s after the player stops, then lets them act', async () => {
  let t = 1000; const { session } = make({ now: () => t });
  session.stop('human');
  expect((await session.runAction('press:A', 'agent'))).toMatchObject({ status: 'refused', message: 'The player pressed stop.' });
  t += 5000;
  expect((await session.runAction('press:A', 'agent')).status).not.toBe('refused');
});
it('an agent’s own stop does not start the hold-off', async () => {
  const { session } = make();
  session.stop('agent');
  expect((await session.runAction('press:A', 'agent')).status).not.toBe('refused');
});
```

Keep unchanged and passing: "a human action interrupts an agent action", "an agent cannot replace an action the player started", "an agent cannot act while the player is holding a button", "an agent’s command does not run if the player took the controls back meanwhile". Remove from each any line that sets the mode to `'agent'`. In "switches modes by voice", use `text mode` / `voice mode`.

In `tests/server/wire.test.ts`:

```ts
it('accepts only voice and text as modes', () => {
  expect(parseClientMsg('{"type":"set","key":"mode","value":"text"}')).toEqual({ type: 'set', key: 'mode', value: 'text' });
  expect(parseClientMsg('{"type":"set","key":"mode","value":"agent"}')).toBeNull();
  expect(parseClientMsg('{"type":"set","key":"mode","value":"controls"}')).toBeNull();
});
```

In `tests/interpret/fastpath.test.ts`:

```ts
it('no longer treats "agent mode" or "controls mode" as commands', () => {
  expect(fastpath('agent mode', ctx)).toBeNull();     // same call shape as the neighbouring tests
  expect(fastpath('controls mode', ctx)).toBeNull();
  expect(fastpath('text mode', ctx)).toEqual({ kind: 'set', key: 'mode', value: 'text' });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tests/server tests/interpret/fastpath.test.ts`
Expected: the new tests FAIL (agent refused outside agent mode; `agent` accepted as a mode).

- [ ] **Step 3: Implement**

- `wire.ts`: narrow `InputMode` and `INPUT_MODES`.
- `fastpath.ts`: the mode regex becomes `^(voice|text) mode$`.
- `session.ts`: delete `AGENT_MODE_ONLY`, the `mode !== 'agent'` line in `refusal`, the "human text in agent mode" branch in `handleText`, and the "leaving agent mode" lines in `set`. `stop(source)`: when `source === 'human'`, set `this.agentHoldUntil = now() + Session.AGENT_HOLD_MS`. `refusal('agent')` returns `{ status: 'refused', message: 'The player pressed stop.' }` while `now() < agentHoldUntil`, checked before the existing busy checks. The page's Stop and a spoken/typed "stop" both already arrive as `stop('human')`.
- `mcp.ts`: delete the constant `A` and its uses; the header comment and `do_action`/`send_command`/`press` descriptions say "Refused while the player is doing something or has just pressed stop."
- `web/src/CommandBar.tsx`, `ModeSwitch.tsx`, `App.tsx`: remove the two dead modes just enough to typecheck (these files are replaced in Tasks 7–8).

- [ ] **Step 4: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit and push**

`git commit -am "feat: Voice and Text are the only modes; agents may act whenever the player is idle"` then `git push origin main`.

---

### Task 2: Pressed buttons travel with each frame

**Files:**
- Modify: `src/server/wire.ts`, `src/emu/emulator.ts`, `src/worker/game-worker.ts`, `src/server/game.ts` (only if it re-wraps frames), `web/src/ws.ts`, `web/src/GameCanvas.tsx`
- Test: `tests/server/wire.test.ts`, `tests/worker/game.test.ts`

**Interfaces:**
- Produces in `wire.ts`: `buttonMask(buttons: Button[]): number` and `maskButtons(mask: number): Button[]`, bit *i* = `BUTTONS[i]`. Frame message on the socket: `[TAG_FRAME, mask, ...rgba]`. The worker's `'frame'` message carries `frame: Uint8Array` of length `1 + 160*144*4` with the mask first.
- Produces in `emulator.ts`: `onFrame?: (screen: ArrayLike<number>, frame: number, held: Button[]) => void` where `held` is exactly what was passed to `pressKeys` that frame.
- Produces in `ws.ts`: `Connection.onFrame` becomes `(rgba: Uint8Array, mask: number) => void`.

- [ ] **Step 1: Write the failing tests**

`tests/server/wire.test.ts`:

```ts
it('packs buttons into one byte and back', () => {
  expect(buttonMask([])).toBe(0);
  expect(buttonMask(['A'])).toBe(1);
  expect(buttonMask(['A', 'RIGHT'])).toBe(1 | 128);
  expect(maskButtons(1 | 128)).toEqual(['A', 'RIGHT']);
});
```

`tests/worker/game.test.ts` (ROM needed; follow the file's existing setup):

```ts
it('every frame message starts with the buttons held since the last one', async () => {
  const masks: number[] = [];
  game.on('frame', (f: Uint8Array) => { expect(f.length).toBe(1 + 160 * 144 * 4); masks.push(f[0]); });
  game.ctl.set(Slot.SPEED_X100, 400);                 // 4×: most frames are skipped
  await game.run('press:A');
  expect(masks.some((m) => m & buttonMask(['A']))).toBe(true);
  masks.length = 0;
  await new Promise((r) => setTimeout(r, 200));
  expect(masks.every((m) => m === 0)).toBe(true);     // idle again: nothing held
});
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tests/server/wire.test.ts tests/worker/game.test.ts`
Expected: FAIL (`buttonMask` not exported; frame length 92160).

- [ ] **Step 3: Implement**

- `emulator.ts` `frame()`: pass the final `hold` array to `onFrame`.
- `game-worker.ts`: keep `let heldSinceSent = 0`; on every `onFrame` OR in `buttonMask(held)`; when a frame is sent, write the mask at byte 0 of a `1 + n` buffer, copy the screen after it, then reset to 0.
- `main.ts` needs no change (`tagged(TAG_FRAME, f)` prefixes the tag). Check `screenPng` and any other consumer of the worker's frame still use `emu.screen()`, not the message.
- `ws.ts`: `onFrame.current?.(bytes.subarray(2), bytes[1])`. `GameCanvas.tsx`: accept and ignore the second argument for now.

- [ ] **Step 4: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit and push**

`git commit -am "feat: each frame carries the buttons held during it"`.

---

### Task 3: Log entries say what was chosen and how surely

**Files:**
- Modify: `src/server/wire.ts`, `src/server/session.ts`
- Test: `tests/server/session.test.ts`

**Interfaces:**
- Produces on `LogEntry`: `chose?: string` (the action's label, without the "(3 steps)" or "→ result" suffixes), `sure?: number` (0–1, only when a model picked the action), `by?: 'jev' | 'standin' | 'direct'` (`direct` = fixed grammar, a click, a button, or an agent's `do_action`).

- [ ] **Step 1: Write the failing tests** (use the file's existing fake-interpreter helpers)

```ts
it('a model-chosen action records what was chosen, how surely, and by whom', async () => {
  const { session, entries } = make({ interpret: act('npc:1@0', 'Talk to Mom', 0.93, 'gateway') });
  await session.handleText('talk to mom', 'human');
  expect(entries.at(-1)).toMatchObject({ heard: 'talk to mom', chose: 'Talk to Mom', sure: 0.93, by: 'jev' });
});
it('a stand-in choice is marked as the stand-in', async () => {
  const { session, entries } = make({ interpret: act('npc:1@0', 'Talk to Mom', 0.8, 'standin') });
  await session.handleText('talk to mom', 'human');
  expect(entries.at(-1)).toMatchObject({ by: 'standin', sure: 0.8 });
});
it('a fixed-grammar command is direct and has no percentage', async () => {
  const { session, entries } = make();
  await session.handleText('press a', 'human');
  expect(entries.at(-1)).toMatchObject({ by: 'direct', chose: 'Press A' });
  expect(entries.at(-1)!.sure).toBeUndefined();
});
it('a choice picked from "did you mean" is direct', async () => { /* choose(logId, 0) → entry.by === 'direct', chose = option label */ });
```

If `make`/`act` helpers do not exist with these shapes, add them to the test file modelled on its current setup; `backend` is the `Interpreted.backend` string and `'jev'` is recorded when it is not `'standin'` and `fellBack` is false, otherwise `'standin'`.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tests/server/session.test.ts`
Expected: FAIL (`chose` undefined).

- [ ] **Step 3: Implement**

`exec` gains a trailing optional parameter `why?: { sure?: number; by: 'jev' | 'standin' | 'direct' }` (default `{ by: 'direct' }`) and sets `chose`, `sure`, `by` on the entry it creates. `handleText` passes `{ sure: p, by }` for `kind: 'act'`.

- [ ] **Step 4: Run everything**, expected PASS. **Step 5: Commit and push** `"feat: log entries record what was chosen and how surely"`.

---

### Task 4: Snapshot gains the player's name, the badges, and who is in battle

**Files:**
- Modify: `src/game/snapshot.ts`
- Test: `tests/game/snapshot.test.ts` (new)

**Interfaces:**
- Produces on `GameSnapshot`: `playerName: string` (`''` before the game starts); `badgeList: boolean[]` (always length 8, bit 0 of `wObtainedBadges` first: Boulder, Cascade, Thunder, Rainbow, Soul, Marsh, Volcano, Earth); `battle.slot: number` (0-based party slot of the Pokémon that is out, from `gs.battle()`'s player side, which reads `wPlayerMonNumber`).

- [ ] **Step 1: Write the failing test**

```ts
describe.skipIf(!hasFixture('fx-battle'))('snapshot', () => {
  it('names the player, lists eight badges, and says which Pokémon is out', () => {
    const s = snapshot(boot('fx-battle'));
    expect(s.playerName.length).toBeGreaterThan(0);
    expect(s.badgeList).toEqual(Array(8).fill(false));
    expect(s.battle!.slot).toBe(0);
    expect(s.party[s.battle!.slot]).toBeDefined();
  });
  it('before the game starts there is no name and no badges', () => {
    const s = snapshot(boot());
    expect(s.playerName).toBe('');
    expect(s.badgeList).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/game/snapshot.test.ts`, expected FAIL. **Step 3: Implement.** **Step 4: Run everything** (the interpreter's `facts()` and MCP `get_state` pass the snapshot through; check their tests still pass). **Step 5: Commit and push** `"feat: snapshot carries the player's name, badge list and the Pokémon in battle"`.

---

### Task 5: Pictures decoded from the ROM, served as PNGs

**Files:**
- Create: `src/game/pics.ts`
- Modify: `src/server/main.ts`
- Test: `tests/game/pics.test.ts` (new), `tests/server/server.test.ts`

**Interfaces:**
- Consumes: `Rom` (`rom.b`, `rom.flat(bank, ptr)`, `rom.species: Map<number, SpeciesData>`), `sym(name)` (flat ROM offsets), `toPng` (already used by the worker for `screenPng`; move it to a shared module if it is private to the worker).
- Produces:

```ts
export interface Pic { w: 56; h: 56; pixels: Uint8Array /* 56*56 values 0..3, 0 = lightest */ }
export class Pics {
  constructor(rom: Rom);
  /** Flat ROM offset of a species' front picture, from its base-stats header. */
  frontAddress(speciesId: number): number;
  mon(speciesId: number): Pic;            // throws on unknown id
  trainer(): Pic;                         // RedPicFront
  /** PNG bytes for a species by the name the snapshot uses, or null if unknown. Cached. */
  monPng(speciesName: string): Buffer | null;
  trainerPng(): Buffer;
}
```

- Routes: `GET /pic/mon/<encodeURIComponent(species name)>.png`, `GET /pic/trainer.png`; `content-type: image/png`, `cache-control: max-age=86400`; 404 for an unknown name; behind the existing `allowed(req)` guard. The route decodes the URL component and looks the name up in a `Map` built from `rom.species`; it never touches the filesystem.
- PNG: 56×56 scaled ×2 (112×112), RGBA; shade 0 fully transparent, shades 1–3 `#a8c070`, `#507848`, `#22361f`.

**Decoding (the one algorithm in this plan):** re-implement, in TypeScript, the game's routine in `vendor/pokered/home/uncompress.asm` (`UncompressSpriteData` and the routines it calls: the two-bit-plane RLE/data packet reader, `UnpackSprite` modes 0–2 with delta decoding via the nybble tables, and XOR of the planes). `vendor/pokered/home/pics.asm` (`UncompressMonSprite`) gives the bank rule, also in the spec: Mew → bank 1; internal index `< 0x1F` → 9; `< 0x4A` → 0xA; `< 0x74` → 0xB; `< 0x99` → 0xC; else 0xD. The header at `BaseStats + (dex-1)*28` (Mew: `MewBaseStats`) holds the picture's size byte at offset 10 and the front pointer (little-endian) at offset 11. The decompressed picture is `w×h` tiles, column-major; place it on the 7×7-tile canvas centred horizontally and bottom-aligned, as `AlignSpriteDataCentered` in `vendor/pokered/home/pics.asm` does. `vendor/` is local reference only; copy no file from it.

- [ ] **Step 1: Write the failing tests** (`tests/game/pics.test.ts`, `describe.skipIf(!hasRom)`)

```ts
const id = (name: string) => [...rom.species.values()].find((s) => s.name === name)!.id;
it('finds each picture where the build says it is, across all five banks', () => {
  for (const [name, symbol] of [['RATTATA','RattataPicFront'],['CHARMANDER','CharmanderPicFront'],['MEW','MewPicFront'],
                                ['RHYDON','RhydonPicFront'],['PIKACHU','PikachuPicFront'],['MEWTWO','MewtwoPicFront'],['BULBASAUR','BulbasaurPicFront']] as const)
    expect(pics.frontAddress(id(name)), name).toBe(sym(symbol));
});
it('decodes all 151 species to pictures that are neither blank nor solid', () => {
  expect(rom.species.size).toBe(151);
  for (const s of rom.species.values()) {
    const p = pics.mon(s.id);
    expect(p.pixels.length, s.name).toBe(56 * 56);
    const shades = new Set(p.pixels);
    expect(shades.size, s.name).toBeGreaterThanOrEqual(3);
    const lit = p.pixels.filter((v) => v !== 0).length / p.pixels.length;
    expect(lit, s.name).toBeGreaterThan(0.08); expect(lit, s.name).toBeLessThan(0.9);
  }
});
it('pictures sit on the floor: the bottom row of tiles is not empty, the top-left corner is', () => {
  const p = pics.mon(id('RATTATA')).pixels;
  expect(p.slice(48 * 56).some((v) => v !== 0)).toBe(true);
  expect(p[0]).toBe(0);
});
it('decodes the trainer', () => { expect(new Set(pics.trainer().pixels).size).toBeGreaterThanOrEqual(3); });
it('looks pictures up by the snapshot’s names, awkward ones included', () => {
  for (const n of ['MR.MIME', "FARFETCH'D", 'NIDORAN♂', 'NIDORAN♀']) expect(pics.monPng(n), n).not.toBeNull();
  expect(pics.monPng('../../etc/passwd')).toBeNull();
  expect(pics.monPng('MISSINGNO')).toBeNull();
  expect(pics.monPng('RATTATA')).toBe(pics.monPng('RATTATA'));   // cached: same Buffer
});
```

If a listed species name is spelled differently by `rom.species` (check with a one-off print), use the ROM's spelling in the test; the lookup key is whatever the snapshot emits.

`tests/server/server.test.ts`:

```ts
it('serves pictures as PNGs and 404s unknown names', async () => {
  const ok = await fetch(`${base}/pic/mon/${encodeURIComponent('RATTATA')}.png`);
  expect(ok.status).toBe(200); expect(ok.headers.get('content-type')).toBe('image/png');
  expect(new Uint8Array(await ok.arrayBuffer()).slice(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47]));
  expect((await fetch(`${base}/pic/trainer.png`)).status).toBe(200);
  expect((await fetch(`${base}/pic/mon/NOPE.png`)).status).toBe(404);
  expect((await fetch(`${base}/pic/mon/..%2F..%2Fpackage.json.png`)).status).toBe(404);
  expect((await fetch(`${base}/pic/trainer.png`, { headers: { host: 'evil.example' } })).status).toBe(403);
});
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run tests/game/pics.test.ts tests/server/server.test.ts`
Expected: FAIL (module not found; 404 for the routes).

- [ ] **Step 3: Implement `Pics` and the routes**

- [ ] **Step 4: Look at the pictures**

Run a one-off script (in the scratchpad, not the repo) that writes `pics.monPng('RATTATA')`, `'CHARMANDER'`, `'MEW'`, `'ONIX'` and `trainerPng()` to the scratchpad and open them with the Read tool. Expected: recognisable, upright, not mirrored, not sheared. If garbled, the bug is in the decoder, not the test thresholds. Then pin two of them:

```ts
it('Rattata and Mew decode to the pictures checked by eye', () => {
  expect(sha1(pics.mon(id('RATTATA')).pixels)).toBe('<value printed after the visual check>');
  expect(sha1(pics.mon(id('MEW')).pixels)).toBe('<value printed after the visual check>');
});
```

- [ ] **Step 5: Run everything**, expected PASS. **Step 6: Commit and push** `"feat: Pokémon and trainer pictures decoded from the ROM"`. Before committing, `git status` must show no image files.

---

### Task 6: The page's logic, as pure modules

**Files:**
- Create: `web/src/pressed.ts`, `web/src/lane.ts`, `web/src/itemIcon.ts`, `web/src/words.ts`, and a `.test.ts` beside each

**Interfaces (all consumed by Tasks 7–9):**

```ts
// pressed.ts
export const MIN_SHOW_MS = 90;
export const TRAIL_MAX = 12;
export class PressTracker {
  /** A frame arrived with this mask at this time. */
  frame(mask: number, now: number): void;
  /** The player pressed or released a page button or key (shown at once, whatever frames say). */
  local(button: Button, down: boolean): void;
  /** Buttons to draw as pressed at this time: local ones, ones in the last mask, and any released less than MIN_SHOW_MS ago. */
  shown(now: number): Button[];
  /** Buttons that went from up to down since the trail was last cleared, oldest first, at most TRAIL_MAX (oldest dropped). */
  trail(): Button[];
  clearTrail(): void;
}

// lane.ts
export const LINGER_MS = 4000;
export type LaneView =
  | { kind: 'idle' }
  | { kind: 'strip'; entry: LogEntry; live: boolean }      // live = still running
  | { kind: 'ask'; entry: LogEntry }
  | { kind: 'answer'; entry: LogEntry }
  | { kind: 'refused'; entry: LogEntry };
/** Which view the command area shows, from the log (oldest first) and the time. 'info' entries are skipped. */
export function laneView(log: LogEntry[], now: number): LaneView;
/** Text for the strip's cells. */
export function stripWords(e: LogEntry): { saidLabel: string; said: string; choseLabel: string; chose: string; sure: string | null; pressingFor: string };

// itemIcon.ts
export type IconKind = 'ball' | 'medicine' | 'heal' | 'disc' | 'stone' | 'key' | 'box';
export function itemIcon(name: string): IconKind;

// words.ts
export function pretty(s: string): string;                 // moved from panels.tsx, same behaviour
export function statusWord(status: string, hp: number): string | null;
export function facingWord(facing: string): string;
export const BADGE_NAMES: string[];                         // 8, in snapshot order
```

- [ ] **Step 1: Write the failing tests**

`pressed.test.ts`:

```ts
it('shows a one-frame tap for at least 90 ms', () => {
  const t = new PressTracker(); t.frame(buttonMask(['A']), 0); t.frame(0, 16);
  expect(t.shown(50)).toEqual(['A']); expect(t.shown(16 + 90)).toEqual([]);
});
it('a locally held button stays shown while frames say it is up', () => {
  const t = new PressTracker(); t.local('LEFT', true); t.frame(0, 0); t.frame(0, 500);
  expect(t.shown(500)).toEqual(['LEFT']); t.local('LEFT', false); expect(t.shown(500 + 90)).toEqual([]);
});
it('the trail records each new press once, in order, and keeps the newest twelve', () => {
  const t = new PressTracker();
  t.frame(buttonMask(['UP']), 0); t.frame(buttonMask(['UP']), 16); t.frame(0, 32); t.frame(buttonMask(['UP']), 48); t.frame(buttonMask(['A']), 64);
  expect(t.trail()).toEqual(['UP', 'UP', 'A']);
  for (let i = 0; i < 20; i++) { t.frame(buttonMask(['B']), 100 + i * 32); t.frame(0, 116 + i * 32); }
  expect(t.trail()).toHaveLength(12); expect(t.trail().at(-1)).toBe('B');
  t.clearTrail(); expect(t.trail()).toEqual([]);
});
```

`lane.test.ts` (build entries with a small `e(status, at, extra)` helper):

```ts
it('is idle with an empty log, and again once a finished command is older than 4 s', () => {
  expect(laneView([], 0).kind).toBe('idle');
  expect(laneView([e('done', 1000)], 5001).kind).toBe('idle');
});
it('shows the strip while running and for 4 s after', () => {
  expect(laneView([e('running', 0)], 60_000)).toMatchObject({ kind: 'strip', live: true });
  expect(laneView([e('done', 1000)], 4999)).toMatchObject({ kind: 'strip', live: false });
});
it('a new command replaces a lingering one at once', () => {
  const v = laneView([e('done', 1000, { heard: 'old', chose: 'Old' }), e('running', 1500, { heard: 'new', chose: 'New' })], 1600);
  expect(v).toMatchObject({ kind: 'strip', live: true }); expect((v as any).entry.heard).toBe('new');
});
it('asking and answers stay until something newer arrives', () => {
  expect(laneView([e('asking', 0)], 999_999).kind).toBe('ask');
  expect(laneView([e('answer', 0)], 999_999).kind).toBe('answer');
});
it('a failure shows as refused for 4 s; info entries never take the lane', () => {
  expect(laneView([e('failed', 0)], 100).kind).toBe('refused');
  expect(laneView([e('asking', 0), e('info', 10)], 20).kind).toBe('ask');
});
it('words the strip by who spoke and who chose', () => {
  expect(stripWords(e('running', 0, { heard: 'go downstairs', chose: 'Take the stairs', sure: 0.957, by: 'jev' })))
    .toEqual({ saidLabel: 'You said', said: '“go downstairs”', choseLabel: 'Jev chose', chose: 'Take the stairs', sure: '96% sure', pressingFor: 'for you' });
  expect(stripWords(e('running', 0, { heard: 'press a', chose: 'Press A', by: 'direct' }))).toMatchObject({ choseLabel: 'Understood directly', sure: null });
  expect(stripWords(e('running', 0, { chose: 'Walk here', by: 'direct' }))).toMatchObject({ said: 'Clicked the screen' });
  expect(stripWords(e('running', 0, { source: 'agent', chose: 'Open the bag', by: 'direct' }))).toMatchObject({ saidLabel: 'An agent said', said: 'Agent action', pressingFor: 'for an agent' });
  expect(stripWords(e('running', 0, { heard: 'x', chose: 'Y', sure: 0.8, by: 'standin' })).choseLabel).toBe('Stand-in chose');
});
```

`at` for a finished entry: the lane needs the time it finished. `LogEntry.at` is creation time; add `doneAt?: number` to `LogEntry` in `wire.ts`, set by `Session.update` whenever status leaves `'running'`, and have `laneView` measure the linger from `doneAt ?? at`. Add one line to a session test: after a completed command, `entries.at(-1)!.doneAt` is a number.

`itemIcon.test.ts`:

```ts
it.each([['POKE BALL','ball'],['ULTRA BALL','ball'],['POTION','medicine'],['SUPER POTION','medicine'],['FULL RESTORE','medicine'],['REVIVE','medicine'],
         ['ANTIDOTE','heal'],['PARLYZ HEAL','heal'],['FULL HEAL','heal'],['TM28','disc'],['HM01','disc'],['MOON STONE','stone'],
         ["OAK's PARCEL",'key'],['TOWN MAP','key'],['BICYCLE','key'],['POKEDEX','key'],['NUGGET','box'],['ESCAPE ROPE','box']])('%s → %s', (n, k) => expect(itemIcon(n)).toBe(k));
```

`words.test.ts`:

```ts
it('names statuses as words, fainted first', () => {
  expect(statusWord('OK', 10)).toBeNull(); expect(statusWord('PSN', 10)).toBe('poisoned'); expect(statusWord('SLP', 10)).toBe('asleep');
  expect(statusWord('PAR', 10)).toBe('paralysed'); expect(statusWord('BRN', 10)).toBe('burned'); expect(statusWord('FRZ', 10)).toBe('frozen');
  expect(statusWord('PSN', 0)).toBe('fainted');
});
it('turns facing into compass words', () => { expect(facingWord('up')).toBe('facing north'); expect(facingWord('left')).toBe('facing west'); });
it('has eight badge names', () => { expect(BADGE_NAMES).toEqual(['Boulder','Cascade','Thunder','Rainbow','Soul','Marsh','Volcano','Earth']); });
```

Check the exact status and facing strings the snapshot emits (`src/game/state.ts`) and use those as inputs.

- [ ] **Step 2: Run** `npx vitest run web/src`, expected FAIL (modules missing). **Step 3: Implement the four modules** (and `doneAt`). **Step 4: Run everything**, expected PASS. **Step 5: Commit and push** `"feat: page logic for pressed buttons, the command lane, item icons and wording"`.

---

### Task 7: The console

**Files:**
- Create: `web/src/Console.tsx`
- Modify: `web/src/App.tsx`, `web/src/GameCanvas.tsx`, `web/src/styles.css`, `web/src/main.tsx`, `web/index.html`, `package.json`
- Delete: `web/src/Gamepad.tsx`

**Interfaces:**
- Consumes: `PressTracker`, `maskButtons`, `Connection.onFrame(rgba, mask)`.
- Produces: `<Console conn={conn} tracker={tracker} onTile={(col,row)=>…} />`; `App` owns one `PressTracker` (in a ref) shared with Task 8's strip. `GameCanvas` calls `tracker.frame(mask, performance.now())` on every frame.

- [ ] **Step 1: Fonts and tokens.** `npm i @fontsource/atkinson-hyperlegible-next @fontsource/pixelify-sans`; import weights 400/600/800 and 500/700 in `main.tsx`. Replace `styles.css` with the mockup's `:root` tokens, base rules and console rules (everything from `.gba` to the pressed rules), minus the mockup-only `.demo` bar. Add the two breakpoints and the reduced-motion rule from Global Constraints.

- [ ] **Step 2: Build `Console`.** Markup as in the mockup. The eight buttons keep `Gamepad`'s pointer handling (pointer capture; `down` on pointerdown, `up` on pointerup/cancel) and also call `tracker.local(b, down)`. Pressed classes are applied outside React: one `requestAnimationFrame` loop reads `tracker.shown(performance.now())` and toggles `.on` on the eight elements (60 fps state must not re-render the tree). Power light: green when `conn.connected`, grey otherwise, and a "Reconnecting…" overlay on the screen when not connected. L and R are `<div aria-hidden>`.

- [ ] **Step 3: Keyboard.** In `App`, keys play the game when `!typingInto(e.target)` (the existing helper), in either mode; also call `tracker.local`. Esc always sends stop.

- [ ] **Step 4: Typecheck, test, build**

Run: `npm run typecheck && npm test && npm run build:web`
Expected: PASS, build succeeds.

- [ ] **Step 5: Look at it.** Restart the app (`kill -TERM $(lsof -iTCP:8787 -sTCP:LISTEN -n -P -t)`, wait for the port to free, `npm start` in the background). Take headless-Chrome screenshots of `http://127.0.0.1:8787` at 1300×900, 940×1200 and 390×844 (`--headless=new --screenshot=<scratchpad path> --window-size=W,H --virtual-time-budget=3000`) and read them. Expected: the console matches the mockup; nothing overflows; at 1300 px the game canvas is at least as wide as before this task (measure before starting: note the old canvas width at 1300 px in the ledger). While a second shell sends a command over the WebSocket (as earlier live checks in this project did), a screenshot shows a lit button.

- [ ] **Step 6: Commit and push** `"feat: the game runs on a drawn handheld whose buttons move with it"`.

---

### Task 8: The command area and the top bar

**Files:**
- Create: `web/src/CommandArea.tsx`, `web/src/TopBar.tsx`
- Modify: `web/src/App.tsx`, `web/src/CommandBar.tsx`, `web/src/styles.css`
- Delete: `web/src/ModeSwitch.tsx`, `web/src/Log.tsx`, `web/src/Settings.tsx`, `web/src/VolumeControl.tsx`

**Interfaces:**
- Consumes: `laneView`, `stripWords`, `LINGER_MS`, `PressTracker.trail/clearTrail`, `LogEntry.chose/sure/by/doneAt`, existing `AutoSender`, existing audio volume functions.
- Produces: `<CommandArea conn tracker mode sendDelay />`, `<TopBar conn sendDelay setSendDelay />`.

- [ ] **Step 1: `CommandArea`.** Row: two-button radiogroup (Voice, Text), the existing `CommandBar` restyled (placeholders: voice "Listening. Say what you want to do.", text "Type what you want to do, then press Enter."; while the lane is `ask`: 'Say “one”, “two” or “three”.'), Stop with its `Esc` hint. Below: the view from `laneView(conn.log, Date.now())`, re-evaluated on a 500 ms timer while a linger is running.
  - `strip`: three cells from `stripWords`; the third shows `tracker.trail()` as key caps, newest lit, refreshed from the same animation-frame loop as the console (or a 100 ms timer). Call `tracker.clearTrail()` when the strip's entry id changes.
  - `ask`: the question and `entry.choices` as large numbered buttons that send `{type:'choose', logId, index}` (only for the newest entry, as now).
  - `answer`: 'You asked “…”. No buttons were pressed.' and the text.
  - `refused`: first two cells, with `entry.text` in the third.
  - `idle`: "Say or type what you want to do." plus three examples: "walk to the door", "talk to mom", "what is Onix weak to?".
  - "Earlier": the 30 newest entries below the current one, newest first; status mark (✓ done, ✕ failed, ■ stopped, ? asking, ✦ answer, · info), quoted `heard`, outcome text, time as HH:MM, "agent" tag by `source`; an answer row shows "Answered" and toggles its text on click.

- [ ] **Step 2: `TopBar`.** Name, then "Jev is connected" (green dot) when `session.jev === 'gateway'`, else "Using the stand-in" (amber dot, `title`: "No TypeSafe key is set, so a simple word-matcher is choosing."). Buttons Sound, Saves, Settings each toggle one popover; opening one closes the others; a click outside closes it. Contents are the existing controls moved over unchanged in behaviour: volume slider and mute; save name, Save, Load and the list of saves; auto-continue, pace, speed, send delay. Esc closes an open panel and still sends stop.

- [ ] **Step 3: Typecheck, test, build**, expected PASS.

- [ ] **Step 4: Look at it.** Restart, then screenshots at the three widths in each state: send "go downstairs" (strip with keys), an ambiguous command (ask), a question (answer), and "go to Cerulean City" (refused), over the WebSocket. Expected: each matches the mockup's corresponding state; the percentage appears only for model choices.

- [ ] **Step 5: Commit and push** `"feat: a three-step strip shows what was said, what was chosen and what is being pressed"`.

---

### Task 9: The sidebar

**Files:**
- Create: `web/src/Sidebar.tsx`, `web/src/ItemIcon.tsx`
- Modify: `web/src/App.tsx`, `web/src/styles.css`
- Delete: `web/src/panels.tsx`

**Interfaces:**
- Consumes: `GameSnapshot` (`playerName`, `badgeList`, `battle.slot`), `/pic/mon/<name>.png`, `/pic/trainer.png`, `itemIcon`, `pretty`, `statusWord`, `facingWord`, `BADGE_NAMES`.
- Produces: `<Sidebar state={state} />`; `<ItemIcon kind={IconKind} />` (seven original inline SVGs, 20×20 viewBox, drawn in the mockup's style; the ball, bottle and box can be taken from the mockup).

- [ ] **Step 1: Build it** as the spec's section 6 and the mockup lay out:
  - `<Pic name>`: `<img src={'/pic/mon/' + encodeURIComponent(name) + '.png'} alt="">` on a `--gb0` tile, `image-rendering: pixelated`; `onError` swaps to the tile with the name's first letter.
  - In battle: enemy picture, `pretty(species)`, level, HP bar and rounded percentage (never the raw numbers), `statusWord`, "a wild Pokémon" / "a trainer's Pokémon".
  - Party: the row at `battle.slot` gets the outline and an "in battle" tag only while `state.battle` is set; fainted rows dim the picture; species shown after the nickname only when they differ; empty: "No Pokémon yet."
  - Trainer card: place `pretty(state.map)` (before the game starts: "Not started yet"), `playerName` and `facingWord`, money, "N seen, M caught", play time, eight slots from `badgeList` with `title`/`aria-label` from `BADGE_NAMES` on lit ones, caption "N of 8 badges".
  - Bag: heading count "N kinds of item"; rows of icon, `pretty(name)`, `×qty`; empty: "The bag is empty."

- [ ] **Step 2: Typecheck, test, build**, expected PASS.

- [ ] **Step 3: Look at it.** Restart with `npm start -- --load fixtures/fx-wild` if that loads (otherwise walk into a battle by commands) and screenshot at the three widths, in and out of battle. Expected: real pictures for the party, the enemy and the trainer; HP numbers readable; nothing overflows at 390 px. Then restart normally so the owner's own game is what is running.

- [ ] **Step 4: Commit and push** `"feat: sidebar with pictures, a trainer card and item icons"`.

---

### Task 10: README, last checks

**Files:**
- Modify: `README.md`, `.env.example` (only if it mentions modes)

- [ ] **Step 1: README.** "Four ways to play" becomes two modes plus "Buttons and keys" and "Agents": Voice and Text as the switch; the console's buttons, clicking the screen and (outside a text box) the keyboard always work; agents may act whenever the player is idle, are refused while the player is doing something, and are held off for 5 seconds after Stop. Remove "controls mode" / "agent mode" from the spoken commands. Add a short "The page" section: the console, the three-step strip, the sidebar pictures (decoded from your ROM while the app runs, never stored). Update the MCP paragraph and the "How it works" list (frames carry pressed buttons). Fix the Status section if it still says the real Jev has not been called.

- [ ] **Step 2: The spec's checks.**

Run: `npm run typecheck && npm test`
Expected: PASS, with the new tests from Tasks 1–6 present.

Run: `git ls-files | grep -Ei '\.(png|jpg|gif|bmp|gb|gbc)$'`
Expected: no output.

Run: `grep -rn "agent mode\|controls mode\|'controls'\|'agent' mode" src web/src README.md`
Expected: no output.

- [ ] **Step 3: Commit and push** `"docs: README for the new page, two modes and always-on agents"`. Leave the app running on the latest build.
