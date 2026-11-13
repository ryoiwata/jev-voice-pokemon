# Spoken answers in a Pokédex-style voice

## Intent

When the player asks a question and Claude answers, the page reads the answer aloud in a flat,
robotic encyclopedia voice that fits the game. The player is often not looking at the answer box
(they play by voice), so hearing the answer is the natural way to get it.

## Goals

- Every answer to the player's own question is spoken, starting about a second after the text starts.
- The voice sounds like a machine in the game's world: clipped, robotic, still easy to understand.
- The game's music dips while the voice talks and comes back afterwards.
- Saying or pressing "stop" silences the voice at once.
- The voice cannot be heard back by dictation and run as a command.
- Free, no new key, and the answer text goes nowhere new.

## Non-goals

- Speaking command results, "did you mean" questions, or the game's own text.
- Speaking answers to questions asked by outside agents (MCP `ask`).
- A cloud voice (ElevenLabs and similar). The design leaves room for one; it is not built now.
- A choice of several voices in the page.

## Anti-goals

- Imitating a real performer. No cloned or actor-trained voices of Professor Oak or the anime's
  Pokédex. The voice is a stock computer voice plus an effect.
- Sound files in the repo, or clips left on disk after they are played.
- The voice making the game harder to control: it must never block typed text, buttons, or "stop".

## Approaches considered

1. **The Mac's built-in voice, effect added by the page (chosen).** The server runs macOS `say` on
   each sentence, sends the clip to the page, and the page plays it through its own sound engine with
   a robotic effect. Free, private, about 0.6 s per sentence on the player's Mac, and the page fully
   controls the sound (music dip, volume, stop). Mac only.
2. **The browser's own speech.** No server work and instant, but the page cannot touch the sound, so
   no effect and no music dip, and the voice differs by browser. Kept only as the fallback where
   `say` is missing.
3. **A cloud voice with the same effect.** Clearest and works anywhere, but needs a key, costs per
   answer, sends text out, adds a network wait, and the effect hides most of the quality.

The player picked 1.

## How it works

### Server

- `Speaker` (new, `src/voice/`): one method, `speak(sentence) → mono 16-bit PCM at 22050 Hz, or null`.
  - `MacSpeaker` runs `say` with no shell, the text never interpreted as options, writing to a
    temporary file outside the repo that is deleted as soon as it is read. Voice name from
    `SPEAK_VOICE` (default `Fred`, the classic flat computer voice). A sentence that takes longer
    than 5 s or fails is skipped; the rest of the answer still plays.
  - On a machine without `say`, there is no speaker and the status sent to the page says so.
  - This interface is the seam for a cloud voice later.
- Sentence cutting (new, pure function): given the answer text so far, returns the sentences that are
  now complete; the remainder is flushed when the answer ends. Abbreviations and decimals ("Lv. 12",
  "1.5") must not cut a sentence short. Text is cleaned for speech first (no "▼", "x3" read as
  "times 3" is not required; keep it simple).
- `Session`: in the branch that answers the player's question, each completed sentence goes to the
  speaker, one at a time and in order, and each clip is emitted to the pages. The fixed replies
  ("Couldn't get an answer just now." and the like) are spoken too.
  - A new question, a "stop" from the player, or the Stop button drops the sentences not yet
    synthesized and tells the pages to go quiet.
  - Agent questions are never spoken.
- Wire: a new binary message `TAG_VOICE` (clip: answer id + mono PCM) and a small JSON message
  meaning "voice, be quiet". Status gains `speech: boolean` (the server can make clips).
- The answering prompt gains one line: write so it reads well aloud (say "level 12", not "Lv12").

### Page

- `VoicePlayer` (in or beside `web/src/audio.ts`), sharing the game's `AudioContext`:
  - Plays clips back to back in arrival order through an effect chain, then its own volume.
  - Effect (all constants in one place so it can be tuned by ear): a narrow "small speaker" band
    (roughly 300–3400 Hz), ring modulation at a low carrier for the metallic buzz, and light
    sample-rate reduction. Understandable first, robotic second.
  - While clips are playing, the game's volume drops to about 30 % and returns over ~300 ms after
    the last clip ends.
  - `stop()` cuts the current clip and empties the queue.
  - Exposes `speaking` (true while playing and for 1.5 s after).
- Fallback: when status says `speech: false`, the finished answer is read with the browser's
  `speechSynthesis` (no effect, no music dip), under the same switch, stop, and guard.
- Sound menu: a "Voice" switch (on by default) and a voice volume slider, remembered like the
  existing volume. Off means clips are ignored. Muting sound mutes the voice too.
- Dictation guard: in Voice mode, while `speaking` is true, text that auto-sends is thrown away
  unless it is a stop phrase (`isStop`). The command box shows a short note that it is waiting for
  the voice to finish. Text mode (Enter to send), on-screen buttons, and keyboard play are not
  affected.
- "Stop" (said, typed, or the Stop button) also stops the voice, even when the game is idle.
- Browsers keep sound off until the first click or key press; before that, answers are text only,
  as game sound is today.

## Calls I made (not the player's words)

- Default voice `Fred`, changeable with `SPEAK_VOICE`.
- The switch lives in the browser, like volume. The server makes clips whenever it can; a page with
  Voice off ignores them.
- Agent questions stay silent.
- Screen-reader users will hear the answer twice (their reader and the voice) unless they turn Voice
  off. The switch is the answer to that; the live region stays as it is.
- 1.5 s of guard after the voice ends, to cover dictation's delay.

## Left to the builder

- Exact effect numbers, tuned by rendering a sample clip the player can listen to before the feature
  is wired in. The sample is made outside the repo.
- Message shapes and names, how the temporary file is named, how `say` is found.
- Tests, failing first: sentence cutting (abbreviations, decimals, remainder flush); clips emitted in
  order with a stand-in speaker; a slow or failed sentence skipped; stop and a new question dropping
  the queue; agent questions silent; the guard dropping auto-sent text but passing "stop"; the
  music-dip rule; the player ignoring clips when Voice is off.

## What cannot be checked without the player

How it sounds. Automated tests cover the plumbing; the player judges the voice from the sample clip
and in the running app, including whether dictation still hears it through their speakers.
