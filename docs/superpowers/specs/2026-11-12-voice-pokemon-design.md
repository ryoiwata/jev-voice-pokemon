# Voice-controlled Pokémon Red, with Jev as the interpreter

Date: 2026-11-12
Status: draft, awaiting approval

Throughout, **(decided)** marks something Ryo said or chose. **(my call)** marks a choice Claude made that Ryo has not explicitly agreed to; these are open to change.

## 1. Intent

Make Pokémon Red playable by someone who can see the screen but can't comfortably work a controller or keyboard. **(decided)**

The player stays the player. They decide everything; the app does the button-pressing between "what I want" and "it happened". You say "walk to the Poké Ball" and the character walks there. In a battle you say "catch with Ultra Ball" and the app opens the bag, finds the Ultra Ball and uses it. **(decided)**

Jev (TypeSafe AI's decision model) is the piece that works out which of the currently possible actions the player meant. Jev cannot write text; it picks one option from a list, quickly and cheaply, and reports how sure it is. That shape fits this job exactly.

## 2. Goals

1. **Say it, and it happens.** A spoken or typed command that is doable from the current situation gets carried out, without asking for confirmation. **(decided)**
2. **Ask only when unsure.** If the app can't tell which action was meant, it offers its top guesses to pick from. **(decided)**
3. **Stop always works.** A stop command halts whatever is in progress, immediately. **(decided)**
4. **Questions get answered, not acted on.** "What's Onix weak to?" goes to a different AI model that can write, and the answer appears on screen. **(decided)**
5. **Four ways in, switchable any time:** voice dictation (Wispr Flow), typed text, direct controls (keyboard, mouse, on-screen buttons), and outside AI agents. **(decided)**
6. **The screen shows everything you'd want while playing:** the game plus party, bag, battle details, location, progress. **(decided)**
7. **Other AI agents can use it** to read the game and act in it. **(decided)**

## 3. Non-goals

- **No long-range goals.** "Beat the game", "go to Cerulean City", "train to level 20" are refused with a short explanation. A command must be doable from where the player is right now. **(decided)**
- **No strategy from the app.** It never chooses a move, a target, or a direction on its own. (The question-answering model may give advice when asked; it never acts.)
- **No spoken output.** The intended player can see the screen. **(decided)** Text-to-speech and screen description are out of scope.
- **No built-in microphone or speech recognition.** Wispr Flow turns speech into text; the app only ever receives text. **(decided)**
- **Not hosted.** It runs on the player's own machine. **(my call)**
- **Other games or ROM versions.** Pokémon Red US/EU only.

## 4. Anti-goals

Things that would make this a failure even if it "works":

- It does something the player didn't ask for because it guessed. Wrong actions in Pokémon can be costly (using a Master Ball, releasing a Pokémon, overwriting a move).
- It keeps going after "stop".
- The player has to do anything beyond Wispr Flow's own dictation hotkey to send a voice command (no Enter, no click).
- The player has to say "next" hundreds of times to get through dialogue.
- The ROM, or anything built from it, ends up in the GitHub repo.
- The Jev or Claude key is reachable from the browser or from the network.

## 5. Constraints

- **Starting point:** `github.com/christianmat/jev-pokemon` (the "reference"). It already has a Game Boy emulator wrapper, a reader for the game's memory, pathfinding, menu and battle navigation, and a Jev client with a mock mode. **(decided: approach A)**
- **Licence:** the reference is GPL-2.0-or-later, so this repo is too. Keep its licence file and credit it in the README.
- **ROM:** Ryo's own copy at `/Users/ryoiwata/Documents/projects/codeshop/Pokemon - Red Version (UE)[!].zip`. The `Pokemon Red.gb` inside has SHA-1 `ea9bcae617fdf159b045185467ae58b2e4a48b9a`, which is exactly the build the reference's memory addresses are written for (verified). Setup unzips it to `roms/red.gb`. `roms/`, `vendor/`, `saves/`, generated data and `.env` are gitignored.
- **Jev access:** early access, reached through Vercel AI Gateway with an `AI_GATEWAY_API_KEY`. Ryo does not have a key yet and will get one later. **(decided)** Everything must work without it.
- **Jev's limits:** at most 255 options per question; no free text out; typical response 70 to 500 ms.
- **Wispr Flow** is a system dictation app. It types the transcribed speech into whichever text field has focus, and it delivers the text when a dictation ends (hold its hotkey, speak, release), not word by word. It is not something our code calls. So a voice command costs one key-hold, and a spoken "stop" lands when the key is released; Esc and the Stop button are instant. Ryo accepted this for the first version. **(decided)** A built-in always-listening microphone is a possible later addition, not part of this design.
- **Platform:** macOS, Node 20+. Setup uses Homebrew to install `rgbds` and builds the `pret/pokered` disassembly to get memory addresses (as the reference does).
- **Repo:** new repo under the `ryoiwata` GitHub account. **(decided)**

## 6. Approaches considered

**A. Build on the reference repo (chosen).** Keep its emulator, memory reader, pathfinding and menu/battle navigation. Replace its "play by itself" loop with "wait for a command, do that one thing". Add the interface and the agent door. Trade-off: GPL licence and inherited design choices, in exchange for starting with the hardest parts already proven by a full 37-hour playthrough.

**B. Fresh build in Python with PyBoy.** Clean slate and free choice of licence, but pathfinding, menu navigation and memory reading would all be rewritten before any of the new work could start.

**C. Everything in the browser.** Easiest to share as a link, but outside agents would have no clean way in and the Jev key would sit in the page. Both cut against stated goals.

Ryo picked A, because the point of the project is the accessible interface, not re-solving how to walk around Pokémon Red.

## 7. How it works

### 7.1 The shape

```
 Wispr Flow ─┐
 typed text ─┼─► text command ─► INTERPRETER ─┬─► action ─► EXECUTOR ─► button presses ─► emulator
 agent text ─┘        (Jev picks from the      ├─► question ─► ANSWERER (Claude) ─► text in the log
                       action list)            ├─► unsure ─► "did you mean…?" choices
 click the game screen ───────────────────────►│
 keyboard / on-screen buttons ─────────────────────────────► raw button presses ─► emulator
                                                            
 emulator ─► memory reader ─► game state ─► ACTION LIST + panels (browser) + agent tools
```

One local Node server owns the emulator. The browser page and outside agents are both clients of it. The game runs continuously in real time whether or not a command is in flight.

### 7.2 The action list

At any moment the server can produce the **action list**: everything doable right now, each with a stable id, a short human label, and a kind. It is rebuilt from game memory whenever the situation changes. This list is the centre of the design; the interpreter chooses from it, clicks on the game screen resolve to it, and agents read it. It is not shown as a panel in the interface: Ryo reviewed a mockup with a clickable "You can, right now" list and asked for it to be removed. **(decided)**

What goes in it, by situation:

- **Walking around:** walk to and face each person, item ball, sign, PC, and other interactable thing on the current map; go through each door, stairway and map edge; talk to / pick up / examine the thing in front of you; open the START menu and its entries; use a field move the party knows (Cut, Surf, …) when it applies; use a bag item.
- **Battle:** each of the active Pokémon's moves; each usable bag item (so "catch with Ultra Ball" is the Ultra Ball entry); switch to each other party Pokémon; run. Safari Zone battles get their own four actions.
- **Dialogue and menus:** continue the text; each option of the menu currently on screen (YES/NO, shop lists, party menu, PC, move-forget lists and so on), including entries that need scrolling.
- **Naming screens:** "name it …" types a name of the player's choosing.
- **Always:** press a single button; hold a direction for N steps; wait.

"Current map" means the area the game currently has loaded (a town, a route, a building floor), not only the tiles visible on the Game Boy screen. **(my call)** Ryo said "doable within the current screen"; the current map is the nearest practical reading, since towns and routes are larger than the screen and "walk to the Pokémon Center door" should work from across town. Anything that would need a second map is out.

Hidden items are not listed, as in the reference; a human can't see them either.

The reference already computes most of this (`buildCandidates` and `execute` in `src/agent/overworld.ts`, `readMenuOptions` in `src/agent/menus.ts`, the option building inside `decideBattle`). The reference mixes "list the options", "ask Jev" and "press the buttons" together and decorates options with strategy hints ("toward the objective"). The work here is separating listing from executing and dropping the strategy.

### 7.3 The interpreter

Takes a text command and the action list; returns one of: an action, "it's a question", "can't be done from here", or "unsure, here are the top guesses".

1. **Fast path, no AI.** A small fixed grammar is recognised directly: "stop" and the other app-control words (7.6); button names ("A", "press B", "start"); directions with an optional count ("up", "left 3"); "next"/"continue"; and number answers to a pending "did you mean" ("one", "the second one"). Stop in particular must never wait on a model. **(my call)**
2. **Jev.** Otherwise Jev gets the player's words, a compact summary of the situation, and one choice question whose options are the action list plus two extra options: *this is a question, not a command* and *this isn't doable from here*. Jev returns its pick with probabilities.
3. **Deciding whether to act.** Act when the top option is clearly ahead; otherwise ask. Starting thresholds: top probability at least 0.6 and at least 0.2 ahead of the runner-up, both adjustable in `.env`. **(my call)** They will need tuning once the real Jev is connected.
4. **Asking.** The top three guesses appear as numbered choices. The player answers by voice ("two"), click, or key. Any new unrelated command replaces the pending question.
5. **Costly actions.** A short list of hard-to-undo actions (releasing a Pokémon, tossing an item, using a Master Ball, overwriting a move, saving over the game) uses a stricter threshold, so a borderline match asks instead of acting. **(my call)** This does not add a confirmation to clear commands.

If the action list ever exceeds 255 entries, the builder uses Jev's score-then-choose two-step, or narrows by kind first.

**The stand-in for Jev.** Until there is a key, a local word-matcher sits behind the same interface: it compares the player's words to action labels (tolerant of spelling and spacing, e.g. "poke ball" / "POKé BALL") and produces scores in the same format. It also detects questions by simple signs (question words, a question mark). The stand-in is a thin stub, not a second product: it should handle commands that name the thing ("walk to the Poké Ball", "use Ember", "Ultra Ball") and no more. No synonym tables, place-name lists or pronoun handling. **(my call)** `JEV_MODE=mock|gateway` in `.env` switches between them, as in the reference. If the real Jev fails or times out, the app falls back to the stand-in for that command and shows that it did. **(decided: stand-in until the key arrives; fallback is my call)**

### 7.4 The executor

Carries out one action at a time by pressing buttons and watching game memory.

- **One at a time.** A new command while one is running replaces it (the running one is stopped first). **(my call)**
- **Stoppable.** It checks for stop between every button press. Stop can come from the word "stop", the Esc key, the on-screen Stop button, or an agent.
- **Gives up cleanly.** If the game does something unexpected partway (a wild battle starts mid-walk, a trainer spots you, a path is blocked), it halts and says what happened. It does not improvise.
- **Says what it's doing.** As soon as an action starts, the log shows what was heard and what was understood ("Walking to Poké Ball, 6 steps"), then the outcome.
- **Stops at the game's own questions.** An action runs until it is done or until the game asks something the command didn't already answer ("Is it OK to toss?", "Forget which move?", "Give a nickname?", "Will you change Pokémon?"). The executor then stops and the question's options become the action list. It never answers such a prompt for the player. (The reference answers some of these itself; that behaviour is removed.) **(my call)**
- **Never writes game memory.** Buttons only, as in the reference.

**Dialogue auto-advance.** Plain dialogue that only needs A to continue is advanced automatically at a readable pace, stopping whenever the game asks for a choice. On by default, with a toggle and a pace setting. **(my call)** Without this the player would have to say "next" for every text box.

### 7.5 The answerer

When the interpreter says "question", the text goes to Claude along with the current game state (location, party with moves and HP, bag, money, badges, battle details if any, recent dialogue). The answer streams into the log. It only ever produces text.

- Called from the server with `ANTHROPIC_API_KEY` from `.env`. Model set by `ANSWER_MODEL`, default `claude-sonnet-5-5`. **(my call)**
- With no key set, questions get a one-line "question answering isn't set up" reply and everything else still works.

### 7.6 Ways in, and switching between them

A four-way switch in the interface: **Voice · Text · Controls · Agent**. **(decided that it switches; the exact behaviour below is my call)**

| Mode | Keyboard goes to | Command box | Agents |
|---|---|---|---|
| Voice | command box | sends itself once the dictated text has stopped changing for a moment (default 800 ms, adjustable) | read only |
| Text | command box | sends on Enter | read only |
| Controls | the game (arrows, Z = A, X = B, Enter = START, Shift = SELECT; remappable) | not focused; Esc is stop | read only |
| Agent | command box | accepts app-control words only (below); sends itself as in Voice mode | may act |

- Voice mode's self-sending means the only key involved is Wispr Flow's own dictation hotkey: the text lands in the focused box and the command goes by itself. The README explains the Wispr Flow setup.
- **Mouse works in every mode:** click a tile or character on the game screen to walk there or interact; click the on-screen gamepad; click a "did you mean" choice.
- **Stop works in every mode,** from anyone. In Agent mode the command box stays live so a voice-only player can still say "stop" or take the controls back.
- **App-control words** are part of the fast path and work by voice or text: "stop", "voice mode" / "text mode" / "controls mode" / "agent mode", "save", "load", and toggling auto-advance. **(my call)**
- **The human always wins.** In Agent mode, a human click on the game screen or the gamepad stops whatever the agent is doing and is carried out; the agent's call returns "interrupted by the player". **(my call)**
- Agents can always read state. They can act only in Agent mode, so the human decides when an agent has the controls.

### 7.7 What's on screen

One page, roughly:

```
┌──────────────────────────────┬──────────────────────────────┐
│                              │ PARTY                        │
│        GAME SCREEN           │  PIKACHU Lv12 ████░ 28/35    │
│     (sharp, scaled up,       │   Thundershock 22/30 …       │
│      clickable)              │  PIDGEY  Lv9  █████ 27/27    │
│                              ├──────────────────────────────┤
├──────────────────────────────┤ BATTLE (when in one)         │
│ [Voice] Text Controls Agent  │  Wild RATTATA Lv4 ███░░      │
│ ┌──────────────────────────┐ ├──────────────────────────────┤
│ │ say or type a command…   │ │ BAG · ¥3,120 · 2 badges      │
│ └──────────────────────────┘ │  Poké Ball ×5  Potion ×2 …   │
│ [ STOP ]   ◄ ▲ ▼ ► (A)(B)    ├──────────────────────────────┤
├──────────────────────────────┤                              │
│ LOG                          │                              │
│  heard: "walk to the pokeball"│                              │
│  → Walking to Poké Ball (6)  │                              │
│  ✓ Facing Poké Ball          │                              │
└──────────────────────────────┴──────────────────────────────┘
```

- **Game screen:** live, scaled with sharp pixels, clickable.
- **Game sound:** the game's music and sound effects play in the browser, with a mute button and volume control. **(decided)** The reference's emulator already exposes an audio tap (`emu.onAudio`, used for its video stream); the server sends that audio to the page alongside the frames. Browsers only start audio after a first click or keypress on the page, so the page shows a "click to enable sound" prompt until then.
- **Party:** species, nickname, level, HP bar, status, each move with PP and type.
- **Battle** (only during one): the opponent's species, level and HP bar; whether it's wild or a trainer.
- **Bag and trainer:** items with counts, money, badges, current location, Pokédex seen/owned counts.
- **Log:** what was heard, what was understood, what happened; "did you mean" choices; answers to questions.
- **Controls strip:** mode switch, command box, Stop, on-screen gamepad, save and load, settings (auto-advance and its pace, voice send delay, key mapping), and a small badge showing whether the real Jev or the stand-in is in use.

Ryo wants the interface to show "everything you'd want while playing Pokémon Red" but did not review a layout (the offer of mockups was skipped in favour of going straight to this document). The panel list and arrangement above are **my call** and are the part of this design most worth a second look.

### 7.8 The door for other AI agents

An MCP server on the same local server (HTTP transport at `/mcp`), so an agent attaches to the game that is already running. **(decided: MCP; details my call)**

Tools:

- `get_state`: location, party, bag, battle, dialogue on screen, mode.
- `get_screen`: the current frame as an image.
- `list_actions`: the action list.
- `do_action(id)`: carry out one entry.
- `send_command(text)`: same path as a typed command, including the interpreter.
- `ask(text)`: send a question to the answerer.
- `press(buttons)`: raw button presses.
- `stop`, `save_state(name)`, `load_state(name)`.

Acting tools return a refusal unless the mode switch is on Agent. Each acting call returns when the action finishes, with the outcome. The browser page uses the same underlying server functions over its WebSocket, so there is one implementation of each.

### 7.9 Saving

- The game's own SAVE works as normal.
- Emulator snapshots: automatic every few minutes and on quit; the app resumes from the latest one on start; named manual saves and loads from the interface. Stored in `saves/` (gitignored).

### 7.10 Safety and privacy

- The server listens on `127.0.0.1` only.
- Keys live in `.env` on the server and are never sent to the page.
- Jev calls keep the reference's zero-data-retention gateway option.

## 8. What changes relative to the reference

| Keep | Rework | Remove |
|---|---|---|
| `src/emu/` emulator wrapper and save states | `src/agent/*`: split into action listing and action execution; drop strategy facts | `src/knowledge/milestones.ts` and all objective/progress tracking |
| `src/game/` memory reader, ROM tables, map grid, pathfinding | `src/server/main.ts`: real-time game loop independent of commands; new API | loop protection, intents (heal/train/shop…), auto nicknaming, auto-setting text speed and battle animations at boot (the player sets options themselves; navigation must work with animations on) **(my call)** |
| `src/jev/` client, gateway backend, call log | `src/jev/mock.ts`: becomes the word-matching stand-in | `src/stream/`, `site/`, streaming overlay |
| `scripts/setup.sh`, `scripts/gen-data.ts` | `web/`: replaced by the new interface | region graph, if nothing left uses it |

New: interpreter, executor, answerer, MCP server, web interface.

## 9. Repo and project setup

- Local folder: `/Users/ryoiwata/Documents/projects/codeshop/jev-voice-pokemon/`. **(my call)**
- GitHub: `ryoiwata/jev-voice-pokemon`, **public** (forks of a public repo are public). **(decided)** Nothing from the ROM is committed.
- A GitHub fork of `christianmat/jev-pokemon`, so it is plain on GitHub that this builds on the reference. **(decided)** The fork carries the reference's full history, including its `site/` folder; `site/` is deleted in the first new commit along with the other removed parts.
- Stays GPL-2.0-or-later with the reference's licence file; the README says what was changed and credits the original.
- Setup also unzips Ryo's ROM into `roms/red.gb` and checks its SHA-1.
- This document is committed as the first new commit on the fork.

## 10. Left to the builder

- Web stack. Suggested: React + Vite + TypeScript for the page, Vitest for tests; the server stays plain Node + `ws` as in the reference.
- Exact message formats between page and server, and the precise `get_state` shape.
- How to split the reference's battle and menu code into list/execute halves.
- How multi-part actions are listed ("use Potion on Pikachu"): enumerate the combinations when the list is small, or do it in two steps through the game's own party menu.
- How click-on-the-game-screen maps pixels to tiles and things.
- The exact wording of labels and how the situation is summarised for Jev, including name spellings that survive dictation (Wispr Flow will write "Pikachu" and "poke ball" its own way).
- Test approach. Suggested: unit tests for the interpreter and stand-in against hand-written action lists (no ROM needed), plus tests that drive the real emulator from locally made save states and are skipped when no ROM is present. Save states are not committed.
- Order of work. Suggested: (1) reference running locally with the game playable in the browser by keyboard, on-screen buttons and state panels; (2) action list, executor, click-on-the-game-screen; (3) interpreter with the stand-in, command box, Voice/Text modes, auto-advance, stop; (4) answerer; (5) MCP door and Agent mode; (6) real Jev and threshold tuning when the key arrives.

## 11. How we'll know it works

Checks marked *(Jev)* need real understanding and are judged with the real Jev connected; the rest must pass on the stand-in.

- *(Jev)* From a fresh start, the game can be played from the title screen through choosing a starter and winning the first rival battle using only dictated commands: nothing touched except Wispr Flow's dictation hotkey.
- "Walk to the Poké Ball" in Oak's lab walks to it and faces it. "Catch with Poké Ball" in a wild battle opens the bag and throws one.
- *(Jev)* "Go to Cerulean City" from Pallet Town is declined with a short explanation, and nothing moves.
- *(Jev)* An ambiguous command ("talk to him" with two people nearby) produces choices, not an action.
- "Stop" during a long walk halts within a step.
- "What is Geodude weak to?" produces a written answer and no button presses.
- An agent connected over MCP can read state in any mode, and can act only in Agent mode.
- `git status` after setup shows no ROM, save or key files as addable.
