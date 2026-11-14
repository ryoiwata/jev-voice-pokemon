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

What this fork changes: the self-playing loop, objectives and strategy are gone. In their place are a list of "what can be done right now", a command interpreter, voice and typed commands, a new web page with sound, question answering, and a door for other AI agents.

## Status

Built, tested, and played with the real Jev. Two things have not been checked by a person end to end: a full voice-only run from the title screen through the first rival battle, and throwing a ball at a wild Pokémon by voice.

`logs/jev-calls.jsonl` records every command, the options offered and Jev's probabilities; use it to tune `ACT_MIN_P` and `ACT_MIN_MARGIN`.

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

## The page

The game runs on a handheld drawn in the middle of the page. Its buttons move whenever the game receives a button press, whoever sent it: Jev carrying out your command, an agent, a click on the game screen, or your own keys.

Under the command box a strip shows the current command as three steps: what you said, what Jev chose (and how sure it was), and the buttons being pressed. If the app is unsure it shows numbered choices there instead; if you asked a question, the answer appears there and no buttons are pressed.

Beside the console are the battle (when there is one), your party, a trainer card with your badges, and your bag. The pictures of Pokémon and of the player are read from your own ROM while the app runs and are never stored.

## Ways to play

The switch under the console has two positions. You can also say "voice mode" or "text mode".

| Mode | How commands arrive |
|---|---|
| **Voice** | Dictate into the command box. The text sends itself once it stops changing (0.8 s by default). |
| **Text** | Type a command and press Enter. |

These always work, in either mode:

- `Esc` or the Stop button halts whatever is running.
- The console's own buttons: click, or press and hold.
- Clicking a spot on the game screen walks there (clicking a person or thing interacts with it).
- The keyboard plays the game whenever you are not typing in a box: arrows, `Z` = A, `X` = B, `Enter` = START, `Shift` = SELECT. In Voice mode the command box keeps the focus for dictation, so switch to Text and click the console to play by keys.

### What you can say

- **Moving about, however you say it:** "move to the right", "go north", "a couple of steps left", "walk up three steps", "forward" (the way you are facing).
- **Until something is in the way:** "keep going north", "continue", "keep going", "all the way down", "go left until something is in the way".
- **Several things in one go:** "get around the boy and continue east", "leave the grass, then read the sign", "open the menu and save the game". Each part is carried out in turn, and the chain ends at the first part that does not simply finish (the game asks something, a part can't be done, or you say stop).
- **Around people:** "go around the boy", "walk past her". Walking in a direction also goes around a person standing in the way ("left three" ends three squares to the left).
- **Grass and water you can see:** "go into the grass", "the grass on the left", "get out of the grass", "go to the water". These are read from the map itself and cover what is on the screen.
- **Furniture and scenery:** "move in front of the bed", "go to the table", "walk over to the TV". This works where the scenery is in the app's table (`src/game/landmarks.ts`), which so far covers Red's house and Oak's lab; elsewhere, click the spot on the game screen or use steps.
- **People by what they look like:** "talk to the man", "talk to the girl", "the nearest person". Each character is described to Jev (a man, an old woman, the nurse) along with where they stand.
- **The menu's entries, directly:** "save the game", "open my bag", "check my trainer card", "open the Pokédex". Saving stops at the game's own "Would you like to SAVE?" for your yes or no.
- **Things on screen, by name:** "talk to the nurse", "enter the Poké Mart", "read the sign", "pick up the item ball", "use the PC", "go north to Route 1".
- **In battle:** "use Ember", "throw Poké Ball", "switch to Pidgey", "use Potion", "run".
- **In menus:** say the option: "yes", "no", "item", "Pokémon". "Go back" closes a menu. (The word "save" on its own is the app's quick save; "save the game" is the game's own SAVE.)
- **Always, with no AI involved:** "stop", "next", "left three", "keep going north", "forward", "press A", "start", "save", "load", "voice mode", "text mode", "name him Sparky" (on a naming screen).
- **Questions:** anything phrased as a question goes to Claude with your current party, bag and location.

Plain dialogue continues by itself at a readable pace and stops whenever the game asks you to choose. Full-screen pages (a Pokémon's stats, a Pokédex entry, the map) stay up until you say "next". You can turn auto-continue off or change the pace in Settings.

"Stop" is heard however it comes out: "stop", "stop it", "please stop", "wait, stop". In Voice mode it is sent the moment it lands in the command box, without the usual pause, and it works at any time: while the character is walking, while Jev is still working out a command, and even when it arrives on the end of another command that had not been sent yet ("walk to the door… stop" just stops). A newer command or any button press also cancels a command that is still being worked out.

If the app is unsure which thing you meant, it shows up to three numbered guesses under the command box; say "one", "two" or "three", or click one. Hard-to-undo actions (tossing an item, releasing a Pokémon, a Master Ball, overwriting a move) need a closer match before they run unasked.

After each action Jev is asked once more whether the command needs anything further, and usually answers that it is done. When a command does need another step, it takes it: up to eight actions for one command, never the same one twice, never one that is hard to undo, and never past anything the game asks.

The app never answers the game's own questions for you. If "toss the Potion" leads to "Is it OK to toss?", it stops there for your yes or no. One exception: when your sentence already contains the answer ("use Potion on Pikachu"), it carries on through the game's "which Pokémon?" prompt.

### Using Wispr Flow

[Wispr Flow](https://wisprflow.ai) types what you say into whichever text box has focus.

1. Put the page in **Voice** mode. The command box takes focus and keeps it.
2. Hold Wispr Flow's dictation key, say the command, release.
3. The text lands in the box and sends itself. No Enter, no click.

Wispr Flow delivers the text when dictation ends, so a spoken "stop" takes effect when you release the key; the app then acts on it at once. `Esc` and the Stop button are instant.

Adding Pokémon and move names to Wispr Flow's dictionary improves how they are spelled. Small misspellings are tolerated either way.

### Spoken answers

When you ask a question ("what is Onix weak to?"), the answer is read aloud as it arrives, a sentence at a time. The game's music dips while it talks.

- With `CARTESIA_API_KEY` in `.env`, [Cartesia](https://cartesia.ai) speaks each sentence. Each sentence of the answer is sent to Cartesia. `CARTESIA_VOICE` picks a voice by id (default: Trevor, a deep, elderly voice) and `CARTESIA_MODEL` the model (default `sonic-3.6`).
- Without a key, on a Mac the server speaks with the Mac's own voice (`say`). Nothing is sent anywhere and no key is needed. `SPEAK_VOICE` picks another installed voice (default `Daniel`).
- Otherwise the page reads the answer with the browser's own voice.
- Only your own questions are spoken, not an AI agent's, and not command results.
- Saying "stop", typing it, `Esc`, or the Stop button silences it at once.
- In Voice mode, anything dictated while the voice is talking (and for 1.5 seconds after) is dropped, in case dictation heard the voice through your speakers. "Stop" always goes through. Headphones avoid the problem entirely.
- **Sound** in the top bar has **Read answers aloud** and a voice volume.

## Jev, and the stand-in

| `.env` | What it does |
|---|---|
| `JEV_MODE` | `gateway` (default): the real Jev. `mock`: a free local word-matcher. |
| `TYPESAFE_API_KEY` | Your TypeSafe key, for the real Jev (early access). With no key, the word-matcher is used whatever the mode. |
| `JEV_SEES_SCREEN` | `1` (default) sends Jev a picture of the game screen with each command; `0` sends only the facts. |
| `JEV_MODEL` | `jev-latest` (default), `jev-preview`, or a pinned release such as `jev-1.14.0`. |
| `ACT_MIN_P`, `ACT_MIN_MARGIN` | How sure Jev must be, and how far ahead of the runner-up, to act without asking (0.6 and 0.2). |
| `COSTLY_MIN_P`, `COSTLY_MIN_MARGIN` | The same for hard-to-undo actions (0.85 and 0.4). |
| `ANTHROPIC_API_KEY` | Turns on question answering. Without it everything else still works. |
| `ANSWER_MODEL` | The Claude model for answers (default `claude-sonnet-5-5`). |

With each command Jev is given the game's facts (where you are and which way you face, what is on the square on each side of you, your party with HP and moves, your bag, money, badges, any battle, the text on screen) and a picture of the screen. In trials Jev could not recognise things in Game Boy graphics (asked to find the bed, the plant or the player, it rated each "not visible"), so it is the facts and the list of options that do the work; the picture is sent for when its vision improves.

The stand-in matches your words against the names of the things on offer. It handles commands that name the thing ("walk to the Poké Ball", "use Ember") and nothing cleverer. If the real Jev is down or slow, that one command falls back to the stand-in and the log says so.

Jev costs $0.042 per million input tokens and output is free; a command is one call of roughly a few hundred to a few thousand tokens. A hard limit of 90 calls a minute (`JEV_MAX_PER_MIN`) caps the worst case.

## Connecting an AI agent

The running game is an MCP server at `http://127.0.0.1:8787/mcp` (streamable HTTP).

```bash
claude mcp add --transport http pokemon http://127.0.0.1:8787/mcp
```

| Tool | What it does |
|---|---|
| `get_state` | Location, party, bag, badges, battle, text on screen, input mode |
| `get_screen` | The current screen as a PNG |
| `list_actions` | Everything doable right now, each with an id |
| `do_action` | Carry out one listed action and wait for the outcome |
| `send_command` | A command in plain words, as the player would say it |
| `press` | Tap buttons in order |
| `ask` | Ask a question; presses nothing |
| `stop` | Stop whatever is running |
| `save_state`, `load_state` | Named saves |

An agent can always read, and it can act whenever you are not doing something yourself. You always come first:

- An agent is refused while something you started is running or while you hold a button.
- Anything you do (a command, a click, a button) takes the controls back from an agent's running action.
- After you press Stop or say "stop", agents are held off for five seconds.

What an agent does shows on the page like anything else: the console's buttons move, and the entry in the list is tagged "agent".

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
- Every picture frame sent to the page carries the buttons held during it, which is how the console's buttons stay in step with the game.
- The **action list** is rebuilt from game memory whenever the situation changes. Hidden items are never listed: a player can't see them either.
- The app only presses buttons. It never writes game memory.
- The server listens on `127.0.0.1` only, refuses connections from other websites or host names (set `DEV_ORIGIN` if you run the page with `npm run dev`), and keeps keys on the server.

| Path | What |
|---|---|
| `src/emu/`, `src/game/` | emulator wrapper, memory reader, map grid, pathfinding (from the reference); `src/game/pics.ts` decodes pictures from the ROM |
| `src/actions/` | what can be done now, and how each thing is carried out |
| `src/worker/` | the game thread and its control block |
| `src/interpret/`, `src/jev/` | fixed grammar, interpreter, Jev client, local stand-in |
| `src/answer/` | question answering |
| `src/server/` | HTTP, WebSocket, session (modes and the command pipeline), MCP |
| `web/` | the page |
| `docs/superpowers/` | the designs and the build plans |

## Tests

```bash
npm test                          # tests that need the ROM or fixtures skip themselves when absent
npx tsx scripts/make-fixtures.ts  # builds save-state fixtures from your ROM by playing from power-on
```

`make-fixtures` plays from the title screen to a wild battle on Route 1 using the app's own action list, so it doubles as an end-to-end check.

## Legal

- **No ROM included.** This repo doesn't contain or link to Pokémon Red, and you need your own legally obtained copy. `roms/` and `saves/` are gitignored.
- **No Nintendo assets.** Game data (symbols, names, maps, font, pictures) is read at runtime from *your* ROM. The console on the page is a generic drawn handheld and the bag's icons are original. The symbol file is generated locally from the [pret/pokered](https://github.com/pret/pokered) disassembly during `npm run setup`, which clones it into `vendor/`. That disassembly isn't redistributed here, and `vendor/` and `src/data/generated.json` are gitignored.
- **Not affiliated.** Pokémon is a trademark of Nintendo, Creatures Inc. and GAME FREAK inc. This is a fan project, not affiliated with or endorsed by Nintendo, Game Freak, The Pokémon Company, TypeSafe AI, Anthropic or Wispr.
- **License.** GPL-2.0-or-later (see [`LICENSE`](LICENSE)), as the reference is, because it builds on the GPL-licensed [serverboy](https://gitlab.com/piglet-plays/serverboy.js) / GameBoy-Online emulator core.

Original project by [Christian Mathiesen](https://github.com/christianmat).
