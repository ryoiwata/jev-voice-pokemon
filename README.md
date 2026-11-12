# Jev Voice Pokémon

Play Pokémon Red by saying what you want.

It is for someone who can see the screen but can't comfortably work a controller or keyboard. You stay the player and make every decision; the app does the button-pressing between "what I want" and "it happened".

- "Walk to the Poké Ball" → the character walks there and faces it.
- "Throw Ultra Ball" in a battle → it opens the bag, finds the Ultra Ball and throws it.
- "What is Onix weak to?" → a written answer, and no buttons pressed.
- "Go to Cerulean City" from Pallet Town → declined. A command has to be doable from where you are.

[Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), TypeSafe AI's decision model, works out which of the currently possible actions a command means. It never chooses a move for you.

> You need your own legally obtained copy of Pokémon Red. No ROM is included or distributed here. See [Legal](#legal).

## Credit

This is a fork of [christianmat/jev-pokemon](https://github.com/christianmat/jev-pokemon) by Christian Mathiesen, in which Jev plays the whole game by itself. The emulator wrapper, the game-memory reader, the pathfinding and the menu and battle button sequences come from that project.

What this fork changes: the self-playing loop, objectives and strategy are gone. In their place are a list of "what can be done right now", a command interpreter, four ways to give commands, a new web page with sound, question answering, and a door for other AI agents.

## Status

Built and tested against the local stand-in for Jev (see below); the real Jev has not been called yet. Three checks need the real Jev and have not been run yet:

- declining a far-away request such as "go to Cerulean City" in every phrasing,
- asking "did you mean…?" on a vague command such as "talk to him",
- a full voice-only run from the title screen through the first rival battle.

After adding `TYPESAFE_API_KEY` to `.env`, tune `ACT_MIN_P` and `ACT_MIN_MARGIN` using `logs/jev-calls.jsonl`, which records every command, the options offered and Jev's probabilities.

## Setup

Requirements: macOS or Linux, Node 20+, git, and Homebrew (setup installs `rgbds` with it).

```bash
git clone https://github.com/ryoiwata/jev-voice-pokemon && cd jev-voice-pokemon
npm install
npm run setup                          # builds pret/pokered to get memory addresses, checks your ROM
cp /path/to/your/pokered.gb roms/red.gb   # your own dump of Pokémon Red (US/EU)
cp .env.example .env
```

The ROM must be the US/EU release, SHA-1 `ea9bcae617fdf159b045185467ae58b2e4a48b9a`. Setup stops with a message if it isn't.

## Run

```bash
npm start                      # builds the page, starts the game: http://127.0.0.1:8787
npm start -- --fresh           # start from power-on instead of resuming
npm start -- --load <name>     # load saves/<name>.state.json
```

The game resumes from its last autosave (every five minutes and on quit). The game's own SAVE works as normal too.

## Four ways to play

Switch between them with the buttons on the page, or by saying "voice mode", "text mode", "controls mode" or "agent mode".

| Mode | How commands arrive |
|---|---|
| **Voice** | Dictate into the command box. The text sends itself once it stops changing (0.8 s by default). |
| **Text** | Type a command and press Enter. |
| **Controls** | The keyboard plays the game: arrows, `Z` = A, `X` = B, `Enter` = START, `Shift` = SELECT. |
| **Agent** | An outside AI agent may play. You can still say "stop" or "voice mode" to take over. |

In every mode: `Esc` or the Stop button halts whatever is running, the on-screen gamepad works, and clicking a spot on the game screen walks there (clicking a person or thing interacts with it).

### What you can say

- **Things on screen, by name:** "talk to the nurse", "enter the Poké Mart", "read the sign", "pick up the item ball", "use the PC", "go north to Route 1".
- **In battle:** "use Ember", "throw Poké Ball", "switch to Pidgey", "use Potion", "run".
- **In menus:** say the option: "yes", "no", "item", "Pokémon". "Go back" closes a menu. (The word "save" on its own is the app's quick save; to use the game's own SAVE, open the menu and click it, or press A on it.)
- **Always, with no AI involved:** "stop", "next", "left three", "press A", "start", "save", "load", "name him Sparky" (on a naming screen).
- **Questions:** anything phrased as a question goes to Claude with your current party, bag and location.

Plain dialogue continues by itself at a readable pace and stops whenever the game asks you to choose. Full-screen pages (a Pokémon's stats, a Pokédex entry, the map) stay up until you say "next". You can turn auto-continue off or change the pace in Settings.

"Stop" is heard however it comes out: "stop", "stop it", "please stop", "wait, stop". Saying it, a newer command, or any button press also cancels a command that is still being worked out.

If the app is unsure which thing you meant, it shows up to three numbered guesses; say "one", "two" or "three", or click one. Hard-to-undo actions (tossing an item, releasing a Pokémon, a Master Ball, overwriting a move) need a closer match before they run unasked.

The app never answers the game's own questions for you. If "toss the Potion" leads to "Is it OK to toss?", it stops there for your yes or no. One exception: when your sentence already contains the answer ("use Potion on Pikachu"), it carries on through the game's "which Pokémon?" prompt.

### Using Wispr Flow

[Wispr Flow](https://wisprflow.ai) types what you say into whichever text box has focus.

1. Put the page in **Voice** mode. The command box takes focus and keeps it.
2. Hold Wispr Flow's dictation key, say the command, release.
3. The text lands in the box and sends itself. No Enter, no click.

Wispr Flow delivers the text when dictation ends, so a spoken "stop" takes effect when you release the key. `Esc` and the Stop button are instant.

Adding Pokémon and move names to Wispr Flow's dictionary improves how they are spelled. Small misspellings are tolerated either way.

## Jev, and the stand-in

| `.env` | What it does |
|---|---|
| `JEV_MODE` | `gateway` (default): the real Jev. `mock`: a free local word-matcher. |
| `TYPESAFE_API_KEY` | Your TypeSafe key, for the real Jev (early access). With no key, the word-matcher is used whatever the mode. |
| `JEV_MODEL` | `jev-latest` (default), `jev-preview`, or a pinned release such as `jev-1.14.0`. |
| `ACT_MIN_P`, `ACT_MIN_MARGIN` | How sure Jev must be, and how far ahead of the runner-up, to act without asking (0.6 and 0.2). |
| `COSTLY_MIN_P`, `COSTLY_MIN_MARGIN` | The same for hard-to-undo actions (0.85 and 0.4). |
| `ANTHROPIC_API_KEY` | Turns on question answering. Without it everything else still works. |
| `ANSWER_MODEL` | The Claude model for answers (default `claude-sonnet-5-5`). |

The stand-in matches your words against the names of the things on offer. It handles commands that name the thing ("walk to the Poké Ball", "use Ember") and nothing cleverer. If the real Jev is down or slow, that one command falls back to the stand-in and the log says so.

Jev costs $0.042 per million input tokens and output is free; a command is one call of roughly a few hundred to a few thousand tokens. A hard limit of 90 calls a minute (`JEV_MAX_PER_MIN`) caps the worst case.

## Connecting an AI agent

The running game is an MCP server at `http://127.0.0.1:8787/mcp` (streamable HTTP).

```bash
claude mcp add --transport http pokemon http://127.0.0.1:8787/mcp
```

| Tool | What it does |
|---|---|
| `get_state` | Location, party, bag, battle, text on screen, input mode |
| `get_screen` | The current screen as a PNG |
| `list_actions` | Everything doable right now, each with an id |
| `do_action` | Carry out one listed action and wait for the outcome |
| `send_command` | A command in plain words, as the player would say it |
| `press` | Tap buttons in order |
| `ask` | Ask a question; presses nothing |
| `stop` | Stop whatever is running |
| `save_state`, `load_state` | Named saves |

An agent can always read. It can act only while you have the page in **Agent** mode, and anything you do there (a click, a button, "stop") takes the controls back: an agent is refused while something you started is running or while you hold a button.

## How it works

```
 dictation ─┐
 typed text ─┼─► command ─► fixed grammar ─► interpreter (Jev picks from the action list)
 agent text ─┘                                   ├─► action ─► button presses ─► emulator
 click on the game screen ──────────────────────►│
                                                 ├─► question ─► Claude ─► text in the log
                                                 └─► unsure ─► "did you mean…?"
 keyboard / on-screen buttons ───────────────────────────────► raw buttons ─► emulator
```

- The emulator runs in its own thread in real time. Stop and held buttons reach it through shared memory, so they work in the middle of a walk.
- The **action list** is rebuilt from game memory whenever the situation changes. Hidden items are never listed: a player can't see them either.
- The app only presses buttons. It never writes game memory.
- The server listens on `127.0.0.1` only, refuses connections from other websites or host names (set `DEV_ORIGIN` if you run the page with `npm run dev`), and keeps keys on the server.

| Path | What |
|---|---|
| `src/emu/`, `src/game/` | emulator wrapper, memory reader, map grid, pathfinding (from the reference) |
| `src/actions/` | what can be done now, and how each thing is carried out |
| `src/worker/` | the game thread and its control block |
| `src/interpret/`, `src/jev/` | fixed grammar, interpreter, Jev client, local stand-in |
| `src/answer/` | question answering |
| `src/server/` | HTTP, WebSocket, session (modes and the command pipeline), MCP |
| `web/` | the page |
| `docs/superpowers/` | the design and the build plan |

## Tests

```bash
npm test                          # tests that need the ROM or fixtures skip themselves when absent
npx tsx scripts/make-fixtures.ts  # builds save-state fixtures from your ROM by playing from power-on
```

`make-fixtures` plays from the title screen to a wild battle on Route 1 using the app's own action list, so it doubles as an end-to-end check.

## Legal

- **No ROM included.** This repo doesn't contain or link to Pokémon Red, and you need your own legally obtained copy. `roms/` and `saves/` are gitignored.
- **No Nintendo assets.** Game data (symbols, names, maps, font) is read at runtime from *your* ROM. The symbol file is generated locally from the [pret/pokered](https://github.com/pret/pokered) disassembly during `npm run setup`, which clones it into `vendor/`. That disassembly isn't redistributed here, and `vendor/` and `src/data/generated.json` are gitignored.
- **Not affiliated.** Pokémon is a trademark of Nintendo, Creatures Inc. and GAME FREAK inc. This is a fan project, not affiliated with or endorsed by Nintendo, Game Freak, The Pokémon Company, TypeSafe AI, Anthropic or Wispr.
- **License.** GPL-2.0-or-later (see [`LICENSE`](LICENSE)), as the reference is, because it builds on the GPL-licensed [serverboy](https://gitlab.com/piglet-plays/serverboy.js) / GameBoy-Online emulator core.

Original project by [Christian Mathiesen](https://github.com/christianmat).
