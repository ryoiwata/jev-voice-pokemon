# Page overhaul: console, Voice/Text, and a sidebar with pictures

Date: 2026-11-12. Builds on `2026-11-12-voice-pokemon-design.md`.
Visual reference: `2026-11-12-ui-overhaul-mockup.html` in this folder (open it in a browser; the bar at the top flips between the three states of the command area). The mockup is the agreed look. Where this document and the mockup differ on behaviour, this document wins; where they differ on looks, the mockup wins.

## Why

The app works, but the page looks like a developer's panel: a bare game picture, a row of four mode buttons, a grey gamepad, text-only stats. The player this is for can see the screen but can't comfortably use a controller. They should be able to tell at a glance what they said, what the app decided, and what it is doing to the game on their behalf. The owner also wants the page to look like a finished thing to show people.

## Goals

1. A Game Boy Advance-shaped console drawn on the page is the centrepiece, with the live game on its screen.
2. The console's buttons visibly press whenever any button is pressed in the game, whoever pressed it: Jev carrying out a command, an agent, a click on the game screen, the keyboard, or the on-screen buttons themselves.
3. The mode switch has two positions, Voice and Text. Agents keep full access without a mode.
4. Under the command box, a strip shows the current command as three steps: what was said, what Jev chose (and how sure it was), and the buttons being pressed.
5. The sidebar is redesigned and shows pictures: each party Pokémon, the enemy in a battle, the player on the trainer card, and a small icon per bag item.
6. The page is legible and consistent: one palette, one type system, works down to phone width, visible keyboard focus, reduced motion respected.

## Non-goals

- No change to how commands are understood (fixed grammar, interpreter, thresholds) or to how actions are carried out.
- No new game features, no key remapping screen, no colour themes or dark mode.
- L and R on the console are drawn but do nothing: Pokémon Red has no use for them.
- Back sprites, animated sprites, and overworld (walking) sprites are not decoded.

## Anti-goals

- No Nintendo art, logo or name in the repo. Pictures are read from the player's own ROM while the app runs, and nothing decoded is written to disk. The console is a generic handheld shape; its wordmark reads "VOICE BOY".
- The console must not make the game harder to see. The game picture stays at least as large as it is today at a normal laptop width (about 1300 px wide).
- Decoration never carries meaning by itself: a pressed button is shown by colour and by movement, HP by bar and by number.

## Approaches

**The console**

1. *Built from page elements (chosen).* The shell, bezel and buttons are ordinary elements styled with CSS. Buttons stay real `<button>`s, so click-and-hold works as it does now, and "pressed" is a class. Scales to any width.
2. *One illustration with hot-spots.* Could look more lifelike, but buttons become overlays that must be kept aligned and animated separately.
3. *A photo of a real GBA.* Rejected: Nintendo's design and logo in the repo.

**Showing presses**

1. *With each picture frame (chosen).* The buttons held during a frame travel with that frame, so console and picture stay in step.
2. *Separate down/up messages.* Can drift from the picture during fast sequences, and needs its own ordering guarantees.

**Pictures**

1. *Decoded on the server, served as images (chosen).* The server decodes a picture from the ROM the first time it is asked for, keeps it in memory, and serves a PNG at its own address. The page uses plain `<img>`; the browser caches.
2. *Pixel data over the live connection.* More moving parts for nothing.
3. *An online sprite collection.* Rejected by the owner: needs internet and pulls Nintendo art from a third party.

The owner picked the first option in each group.

## What the owner decided

- A GBA as the main screen, with buttons that press when Jev interacts.
- Voice and Text are the only modes in the page; agents stay able to connect.
- Sidebar stats are polished and have sprites, read from the ROM (option 1 above); bag items get drawn generic icons because Red has no item pictures.
- The game picture sits on the wider GBA screen with black bars at the sides.
- Keyboard play is kept without being a mode.
- The look in the mockup: light lavender page, indigo console, red for Stop and battle, yellow for a pressed button, the three-step strip, the three states of the command area, the four sidebar sections.

Everything else below is the designer's call and is marked as such where it matters.

## Design

### 1. Modes and who may act

`InputMode` becomes `'voice' | 'text'`. Default stays `voice`.

- **Voice:** the command box takes focus and keeps it, and sends by itself after the pause (unchanged).
- **Text:** the box sends on Enter (unchanged).
- Saying "voice mode" or "text mode" still switches. "Controls mode" and "agent mode" are no longer commands; they fall through to the interpreter like any other words.

**Agents (designer's call, agreed in outline):** an agent may act at any time through MCP. The existing priority rules stay exactly as they are: an agent is refused while something the player started is running or while the player holds a button, and anything the player does (a command, a click, a button, Stop) takes the controls back from an agent's running action. The refusal message for that case no longer mentions a mode. `get_state` still reports `inputMode`. Tool descriptions drop the "only in Agent mode" sentence.

Because agents are no longer gated by a switch, **Stop also holds agents off for a moment**: after the player presses Stop (or says it), agent actions are refused for 5 seconds with "The player pressed stop." This keeps a looping agent from instantly undoing a stop. (Designer's call.)

**Keyboard (designer's call):** the keys play the game (arrows, Z = A, X = B, Enter = START, Shift = SELECT) whenever focus is not in a text field. In Text mode the player clicks the console (or presses Tab out of the box) to play by keys and clicks the box to type. In Voice mode the box keeps focus, so the keyboard is for typing; the on-screen buttons and clicking the game screen still work. Esc stops in every case.

### 2. The console

Built as in the mockup: shell with two shoulder tabs, D-pad and START/SELECT on the left wing, bezel and screen in the middle, A/B and a speaker grille on the right wing, a power light.

- The screen is 3:2 and black; the game canvas is centred in it at full height with its 10:9 shape, pixelated scaling. Clicking a spot on the canvas still walks there.
- All eight game buttons are real buttons with the current press-and-hold behaviour and an accessible name. L and R are not buttons.
- The power light is green when connected and grey when the connection is down; while down, the screen shows "Reconnecting…" over the last picture.
- Below 940 px the page becomes one column (console, command area, sidebar). Below 560 px the wings shrink (smaller D-pad and A/B) so the screen keeps at least 60% of the console's width.

### 3. Pressed buttons

The game thread records, for each frame it sends to the page, the set of buttons that were held during the frames since the last one it sent (a union, so a 4-frame tap is never missed when frames are skipped at 2× or 4× speed). The set is one byte, one bit per button in the order of `BUTTONS` in `wire.ts`.

- Frame message becomes: tag, 1 byte of buttons, then the picture. The page reads the byte and sets the pressed class on the matching console buttons.
- This covers every source, because it is taken where buttons reach the emulator: buttons an action presses and buttons the player holds.
- So that a single-frame press is visible, the page keeps a button shown as pressed for at least 90 ms.
- A button the player is physically pressing on the page shows pressed immediately (local state), not after the round trip.

### 4. The command area

One row: the Voice/Text switch, the command box, Stop (with its Esc hint). Below it, exactly one of these, by the newest log entry:

| Newest entry | Shown |
|---|---|
| running, or finished in the last 4 s | the three-step strip |
| asking | "Which one did you mean?" with up to three large numbered buttons |
| an answer | the question, "No buttons were pressed.", and the answer text as it streams |
| a refusal or failure | the strip's first two cells, with the reason in place of "Pressing" |
| nothing recent | a single quiet line: "Say or type what you want to do." with three example commands |

**The strip:**
- *You said:* the words as heard. For a click on the screen: "Clicked the screen". For an agent: the agent's words or "Agent action", and the label reads "An agent said".
- *Jev chose:* the action's label, with "NN% sure" when a model chose it. When the fixed grammar handled it (stop, "left three", "press A") the label reads "Understood directly" and there is no percentage. When the stand-in chose, the label reads "Stand-in chose".
- *Pressing:* the buttons pressed since this command started, newest lit, oldest dropped after 12. The page builds this from the frame byte: a button is appended each time it goes from up to down. Suffix "for you" or "for an agent".

To support this, a log entry gains two optional fields: `chose` (the action label) and `sure` (0 to 1, present only when a model picked). `source` already says who.

**Earlier:** the history list under it, newest first, 30 entries, each with a status mark, the quoted words, the outcome and the time, and an "agent" tag when an agent did it. Answers in history are collapsed to "Answered" and expand on click.

**Top bar:** the name, "Jev is connected" / "Using the stand-in" (with the reason as a tooltip), and three buttons that each open a small panel: Sound (volume, mute), Saves (name, save, load, list), Settings (auto-continue, pace, speed, send delay). Only one panel is open at a time. Esc with a panel open closes the panel and also stops the game: Stop must never be swallowed. (Designer's call.)

### 5. Pictures from the ROM

New module `src/game/pics.ts`, used by the server process (it loads the ROM read-only; the game thread is not involved).

- `monPic(speciesId): { w, h, pixels }` decodes the front picture: read the picture pointer and size from the species' base-stats header, pick the bank by the game's own rule for species index (Mew: bank 1; index below 0x1F: bank 9; below 0x4A: bank 0xA; below 0x74: bank 0xB; below 0x99: bank 0xC; otherwise bank 0xD), run the game's picture decompression (the routine at `UncompressSpriteData`, re-implemented in TypeScript), and return 2-bit pixels on a 56×56 canvas, centred and bottom-aligned as the game does.
- `trainerPic(): …` the same for `RedPicFront`.
- PNGs are rendered with the four shades in the palette (`--gb0`..`--gb3` equivalents), lightest shade transparent so the tile colour shows through.

Routes (same Host/Origin guard as the rest):
- `GET /pic/mon/<species-name>.png` where the name is the species name as it appears in the snapshot. Unknown name: 404.
- `GET /pic/trainer.png`.
- Cached in memory after first decode; `Cache-Control: max-age=86400`.

If a picture fails to decode or load, the page shows the tile with the first letter of the name. The sidebar never breaks because of a picture.

The decoder is the riskiest piece. Its tests (ROM needed, skipped without it) check: the header-derived address equals the build's symbol for several species across all five banks (Rattata, Charmander, Mew, and one from each remaining bank); every one of the 151 species decodes without error to a picture that is neither blank nor solid; and a checksum of two decoded pictures is pinned once they have been checked by eye.

### 6. The sidebar

Four sections, top to bottom, as in the mockup.

**In battle** (only during a battle): red banner; the enemy's picture, name, level, HP bar and percentage (the game does not tell the player the enemy's exact HP, so neither does the page), status if any, and "a wild Pokémon" or "a trainer's Pokémon".

**Party:** one row per Pokémon: picture, nickname (species after it when they differ), level, HP bar with numbers, status as a word ("poisoned", "asleep", "paralysed", "burned", "frozen", "fainted"), moves with PP in two columns, a move with no PP left in red. The Pokémon currently in battle is outlined and tagged "in battle". A fainted Pokémon's picture is dimmed. Empty party: "No Pokémon yet."

**Trainer card:** indigo card with the player's picture, the place name, the player's name and facing ("facing north"), money, Pokédex seen and caught, play time, and eight badge slots with the earned ones lit, captioned "N of 8 badges". Hovering or focusing a lit badge names it.

**Bag:** a list, each item with an icon, name and quantity. Icons are drawn (inline SVG, in the repo, original work): a ball, a medicine bottle, a status heal, a TM/HM disc, a stone, a key item, a generic box. `web/src/itemIcon.ts` maps an item name to one of these by simple rules (name ends in BALL, is in a short list of medicines, starts with TM or HM, ends in STONE, is a known key item, else box). Empty bag: "The bag is empty."

Snapshot additions needed: the player's name, which party slot is in battle, which badges are held (as eight booleans, not only a count).

### 7. Look

Tokens as in the mockup's `:root` (lavender desk `#dcd9ea`, paper `#f8f7fc`, ink `#1c1a3a`, console indigo `#4a3fb0`, red `#d8342c`, pressed yellow `#ffd23f`, HP green/amber/red, four Game Boy shades for picture tiles).

Type: Atkinson Hyperlegible Next for everything that is read, including all numbers; Pixelify Sans only for names and section headings. Both are bundled with the page from npm packages (`@fontsource/...`) so the app works offline and makes no outside requests. (Designer's call; the mockup loads them from Google only because it is a mockup.)

Motion: only button presses and the "listening" dot. With reduced motion the dot is steady and buttons change colour without moving.

Contrast: text on paper, on indigo and on red all meet 4.5:1. The pressed yellow is paired with ink text.

## What changes where

| Area | Change |
|---|---|
| `src/server/wire.ts` | two modes; frame layout with the buttons byte; `chose` and `sure` on log entries |
| `src/emu/emulator.ts`, `src/worker/game-worker.ts` | collect held buttons per sent frame |
| `src/server/session.ts` | drop the agent-mode gate and the controls mode; 5 s agent hold-off after Stop; fill `chose`/`sure` |
| `src/interpret/fastpath.ts`, `src/server/mcp.ts` | mode phrases; tool descriptions |
| `src/game/pics.ts` (new), `src/server/main.ts` | decoder and the two routes |
| `src/game/snapshot.ts` | player name, active slot, badge list |
| `web/src/*` | new layout and components; old `Gamepad`, `ModeSwitch`, `panels`, `Log`, `Settings`, `VolumeControl` are replaced |
| `README.md` | modes, agents, pictures, screenshot-free description of the page |

Existing tests that assert four modes or agent-mode refusals are rewritten to the new rules, not deleted.

## Left to the builder

- Component and file split inside `web/src`, CSS organisation.
- Exact sizes and spacing below the two breakpoints.
- How the top-bar panels are positioned (popover or inline drawer).
- Wording of tooltips and empty states not quoted above, in the same plain voice.

## Checks before calling it done

- All tests pass, including new ones for: the buttons byte (a 4-frame tap at 4× speed still shows), agent refused while the player's action runs, agent hold-off after Stop, two-mode parsing, picture decoding, item icon rules, the strip's state selection.
- In a real browser at 1300 px, 940 px and 390 px wide: nothing overflows, the game picture is not smaller than today at 1300 px.
- A spoken command shows all three steps and the console's buttons move with the game.
- With the ROM absent from a fresh clone, the repo contains no Nintendo art (`git grep` for picture data finds nothing; no PNGs of game art are committed).
