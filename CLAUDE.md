# Jev Voice Pokémon

Public fork of christianmat/jev-pokemon. README.md covers setup, design and layout. Designs and build plans are in `docs/superpowers/`.

## Working on this project

- Use the TypeSafe skill (`typesafe` plugin) for anything that touches Jev: questions, state, thresholds or API calls.
- Ask before sending live requests. They use `TYPESAFE_API_KEY` (and `ANTHROPIC_API_KEY` for answers). That includes `npm run eval` and `scripts/verify.ts --live`.
- Every question and threshold lives in `src/interpret/questions.ts`. The thresholds were tuned on jev-1.14.0 with `npm run eval`. After changing questions or thresholds, rerun the eval (with the user's OK).
- The player makes every decision. The app only presses buttons for what was asked. It never writes game memory, and it never answers the game's own questions unless the player's sentence already did. Hard-to-undo actions use the stricter `costly` thresholds.
- This repo is public. Never commit a ROM, save states, anything decoded from the ROM, or Nintendo assets. `roms/`, `saves/`, `vendor/` and `src/data/generated.json` stay gitignored.
- The user's own game runs on port 8787, and its autosave is their progress. To test, use the verify skill, not `npm start`. It loads a fixture and never autosaves.
- Commit and push finished, tested changes straight to `main` on `origin` without asking. No branches or PRs, and never push to `upstream`.
