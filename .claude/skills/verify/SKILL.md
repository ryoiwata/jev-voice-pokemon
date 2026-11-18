---
name: verify
description: Check a change to jev-voice-pokemon by running the real game. Use before committing any change to the server, actions, interpreter, Jev client or web page, and whenever asked to verify, smoke test or confirm that something works.
---

# Verify jev-voice-pokemon

Run the checks in order. Stop at the first failure, fix it, and run again from step 1. If the same check still fails after three attempts, stop and tell the user what failed and why.

## 1. Static checks and tests (about 10 seconds)

```bash
npm run typecheck
npm test
```

Tests that need the ROM or save fixtures skip themselves when those are missing. If the change touches those areas and the tests were skipped, say so.

## 2. Drive the game (about 1 second per run)

`scripts/verify.ts` loads a save fixture, starts the server on a free port, and drives it through the MCP door, the same way an agent would. It never writes the autosave or `logs/jev-calls.jsonl`. It uses the free stand-in Jev unless you pass `--live`.

```bash
npx tsx scripts/verify.ts --fixture <fixture> <steps...>
```

| Step | What it does |
|---|---|
| `state` | Location, party, bag, battle, text on screen |
| `actions` | Everything that can be done right now, with ids |
| `say:<command>` | A command in plain words, as the player would say it |
| `do:<id>[:<arg>]` | One action from the list, e.g. `do:steps:left:2` |
| `press:<A,B,...>` | Raw buttons |
| `ask:<question>` | A question (needs `--live`, which also enables Claude answers) |
| `shot` | Saves the screen to `logs/verify/<fixture>-<n>.png`. Open it with Read and look at it. |

The script exits with 1 if any step fails.

Fixtures (in `saves/fixtures/`):

| Fixture | Situation |
|---|---|
| `fx-bedroom` | Start of the game, Red's bedroom |
| `fx-pallet` | Outside in Pallet Town |
| `fx-lab` | Oak's lab |
| `fx-dialog` | Oak's opening speech (a text box) |
| `fx-menu` | A menu (the naming screen) |
| `fx-wild` | A wild battle on Route 1 |
| `fx-battle` | The rival battle in Oak's lab |
| `fx-forest` | Viridian Forest |

If they're missing, `npx tsx scripts/make-fixtures.ts` rebuilds them from the ROM by playing from power-on. That is also an end-to-end check in itself.

Pick the fixture closest to the change. Check `state` before and after the step that exercises it, and take a `shot` whenever what's on screen matters. Example for a movement change:

```bash
npx tsx scripts/verify.ts --fixture fx-pallet state "say:walk to the sign" "do:steps:left:2" state shot
```

## 3. The page (for changes under `web/` or to what the page shows)

```bash
npm run build:web
npx tsx scripts/verify.ts --fixture fx-pallet --port 8799 --keep
```

Open http://127.0.0.1:8799 with Claude in Chrome, exercise the change (type a command in Text mode, click the console's buttons), and take a screenshot. Stop the server with Ctrl+C (or `pkill -INT -f "verify.ts.*--port 8799"`). Don't use port 8787; that's the user's own game.

## 4. Real Jev (only with the user's OK)

`--live` sends each command's state and questions to TypeSafe using `TYPESAFE_API_KEY` from `.env` (about $0.0001 per command). Ask the user first. For changes to questions or thresholds, run `npm run eval` instead (about 90 commands); ask first for that too.

## Report

Show the actual output: the test counts, the `state` lines before and after, and any screenshots. Don't just say it passed.
