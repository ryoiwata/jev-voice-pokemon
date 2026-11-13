# Spoken Answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read Claude's answers to the player's questions aloud in a robotic, Pokédex-style voice.

**Architecture:** The server cuts the streaming answer into sentences, has macOS `say` turn each into
mono PCM, and sends the clips to the page over the existing WebSocket. The page plays them in order
through a Web Audio effect chain on the game's own `AudioContext`, dips the game music meanwhile, and
holds back dictated text while the voice talks. Without `say`, the page reads the finished answer
with `speechSynthesis`.

**Tech Stack:** Node + TypeScript (server), `child_process.execFile` for `say`, React 19 + Web Audio
(page), Vitest (+ jsdom for page tests).

**Spec:** `docs/superpowers/specs/2026-11-13-spoken-answers-design.md`

## Global Constraints

- Only answers to the player's own questions (`source === 'human'`) are spoken; agent questions (MCP `ask`, agent text) never are.
- No cloned or actor-imitating voice. Stock `say` voice plus effect only. Default voice `Fred`, overridable with `SPEAK_VOICE`.
- No sound files in the repo. The temporary WAV lives in `os.tmpdir()` and is deleted as soon as it is read, success or failure.
- Clips: mono Int16 at 22050 Hz. A sentence taking longer than 5000 ms or failing is skipped; the rest still play.
- Music dips to 30 % while the voice plays and comes back over ~300 ms after the last clip.
- Voice counts as "speaking" while clips play and for 1500 ms after the last one ends.
- Guard: in Voice mode, auto-sent text is discarded while speaking unless `isStop(text)`. Text mode, buttons, keyboard play are never blocked.
- "Stop" (said, typed, or the Stop button) silences the voice, even when the game is idle.
- Voice switch on by default; voice volume remembered in `localStorage` like the game volume.
- Every test written first and seen failing. After each task: `npm run typecheck` and `npm test` green, commit, `git push origin main` (fork only, never `upstream`, no PRs).

## Review Focus

1. **Answer text that `say` would treat as commands** — `say` reads `[[ ... ]]` as embedded commands (rate, volume, silence). Claude's text must be stripped of `[[`/`]]` so it cannot change or mute the voice. Test in Task 2.
2. **The final answer differs from what streamed** (a refusal replaced by "I can't answer that one.", a failure after partial text). The player should hear the final text, not half of the streamed one. Test in Task 4.
3. **A second question while the first is still being spoken** — the first answer's voice stops and its unsent sentences are never synthesized. Test in Task 4.
4. **Two browser tabs open** — both receive clips; each plays them independently and neither breaks. Covered by broadcasting like game audio; no extra test (noted for the reviewer).
5. **Dictation arriving after the voice ended but inside the 1.5 s tail** — still discarded; dictation arriving after the tail is sent. Test in Task 6.

---

## File Structure

- `src/voice/sentences.ts` (new): `speechText`, `SentenceCutter` — pure text work.
- `src/voice/speaker.ts` (new): `SpeakerLike`, `MacSpeaker`, `parseWav`, `findSpeaker`.
- `src/server/wire.ts`: `TAG_VOICE`, `voiceClip`/`readVoiceClip`, `SessionInfo.speech`, `ServerMsg` `hush`.
- `src/server/session.ts`: optional `speaker` dep, speaking the human question branch, hush on stop/new question.
- `src/server/main.ts`: build the speaker, forward `voice` and `hush` events.
- `src/answer/answerer.ts`: one prompt line about reading aloud.
- `web/src/voice.ts` (new): `VOICE_FX`, `crush`, `VoicePlayer`, `speakFallback`.
- `web/src/audio.ts`: share the context, `duck(on)`.
- `web/src/ws.ts`, `web/src/App.tsx`, `web/src/TopBar.tsx`, `web/src/CommandBar.tsx`, `web/src/autoSend.ts`: wiring, Voice switch, guard.
- `README.md`: a short "Spoken answers" section.

---

### Task 1: Effect tuning page (throwaway, outside the repo)

**Files:** Create in the scratchpad only: `voice-tune.html` (+ the sample WAV embedded as base64).

**Interfaces:** Produces the starting numbers for `VOICE_FX` in Task 5.

- [ ] **Step 1:** Render a sample with `say -v Fred -f - -o sample.wav --data-format=LEI16@22050` from the text: "Onix, the rock snake Pokémon. It is weak to Water and Grass moves. Your Squirtle knows Bubble, so use that."
- [ ] **Step 2:** Write `voice-tune.html`: the sample embedded, a Play button, and sliders for low cut (100–800 Hz), high cut (2000–6000 Hz), ring frequency (0–120 Hz), ring mix (0–1), sample hold (1–4), plus a "Copy numbers" box showing the current values as a `VOICE_FX` object. Same chain as Task 5 describes.
- [ ] **Step 3:** Publish it as a private artifact and give the player the link. **Do not wait** — Tasks 2–4 do not use these numbers. If the player has sent numbers by Task 5, use them; otherwise use the defaults there and say so at the end.

### Task 2: Text for speech and sentence cutting

**Files:** Create `src/voice/sentences.ts`; Test `tests/voice/sentences.test.ts`.

**Interfaces:**
- Produces: `speechText(s: string): string`; `class SentenceCutter { push(soFar: string): string[]; finish(final: string): { sentences: string[]; replaced: boolean } }`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('speechText', () => {
  it('reads levels as words', () => expect(speechText('Pikachu Lv12 and Onix Lv. 14')).toBe('Pikachu level 12 and Onix level 14'));
  it('drops game arrows, markdown and say commands', () => expect(speechText('**Use** [[volm 0]] Bubble▼')).toBe('Use volm 0 Bubble'));
});
describe('SentenceCutter', () => {
  it('returns each sentence once, when it is complete', () => {
    const c = new SentenceCutter();
    expect(c.push('Onix is weak')).toEqual([]);
    expect(c.push('Onix is weak to Water. Use Bub')).toEqual(['Onix is weak to Water.']);
    expect(c.push('Onix is weak to Water. Use Bubble! It')).toEqual(['Use Bubble!']);
    expect(c.finish('Onix is weak to Water. Use Bubble! It works.')).toEqual({ sentences: ['It works.'], replaced: false });
  });
  it('does not cut on decimals or abbreviations', () => {
    const c = new SentenceCutter();
    expect(c.push('Mt. Moon is 1.5 times Lv. 3 Mr. Mime. Next')).toEqual(['Mt. Moon is 1.5 times level 3 Mr. Mime.']);
  });
  it('says the final text whole when it is not what streamed', () => {
    const c = new SentenceCutter();
    c.push('Here is how to. Then');
    expect(c.finish("I can't answer that one.")).toEqual({ sentences: ["I can't answer that one."], replaced: true });
  });
  it('speaks a fixed reply that never streamed', () => expect(new SentenceCutter().finish("Couldn't get an answer just now.")).toEqual({ sentences: ["Couldn't get an answer just now."], replaced: false }));
  it('skips empty pieces', () => expect(new SentenceCutter().finish('  ')).toEqual({ sentences: [], replaced: false }));
});
```

- [ ] **Step 2:** Run `npx vitest run tests/voice/sentences.test.ts` — Expected: FAIL, module not found.
- [ ] **Step 3: Implement.** A sentence ends at `.`, `!` or `?` (repeats allowed) followed by whitespace, except a `.` after `Mt|Mr|Mrs|Dr|St|Prof|Lv|vs|e\.g|i\.e` or between digits. Returned sentences pass through `speechText` and are trimmed; empty ones are dropped. `finish(final)`: if `final` starts with the text the cutter has consumed so far, return the remaining sentences of `final` (the tail is one sentence even without a closing mark), `replaced: false`; otherwise every sentence of `final`, `replaced: true` — except when nothing was consumed yet, which is `replaced: false`. `speechText`: remove `▼`, `*`, `_`, `` ` ``, `#`, `[[`, `]]`; `Lv.? ?(\d)` → `level $1`; collapse whitespace.
- [ ] **Step 4:** Run the test — Expected: PASS. Then `npm run typecheck && npm test`.
- [ ] **Step 5:** Commit `Speech text and sentence cutting for spoken answers`, push.

### Task 3: The Mac speaker

**Files:** Create `src/voice/speaker.ts`; Test `tests/voice/speaker.test.ts`.

**Interfaces:**
- Produces: `interface SpeakerLike { speak(text: string): Promise<Int16Array | null> }`; `VOICE_RATE = 22050` (exported from `src/server/wire.ts` so the page shares it); `parseWav(buf: Uint8Array): Int16Array | null`; `class MacSpeaker implements SpeakerLike { constructor(opts?: { voice?: string; timeoutMs?: number; run?: Runner }) }`; `findSpeaker(): SpeakerLike | null`.
- `type Runner = (file: string, args: string[], input: string, timeoutMs: number) => Promise<void>` — the seam tests replace; the real one is `execFile` with the text written to stdin.

- [ ] **Step 1: Write the failing tests**

```ts
it('finds the samples after a JUNK chunk', () => {
  const wav = makeWav([1, -2, 3], { junk: 28 }); // test helper writes RIFF/WAVE, JUNK, fmt (1 ch, 22050, 16-bit), data
  expect(Array.from(parseWav(wav)!)).toEqual([1, -2, 3]);
});
it('rejects a WAV that is not mono 16-bit 22050 Hz', () => expect(parseWav(makeWav([1], { channels: 2 }))).toBeNull());
it('passes the text on stdin, never as arguments', async () => {
  const calls: any[] = [];
  const sp = new MacSpeaker({ run: async (file, args, input) => { calls.push({ file, args, input }); fs.writeFileSync(args[args.indexOf('-o') + 1], makeWav([5])); } });
  expect(Array.from((await sp.speak('-v Bad hi'))!)).toEqual([5]);
  expect(calls[0].file).toBe('say');
  expect(calls[0].args).toEqual(['-v', 'Fred', '-f', '-', '-o', expect.stringMatching(/\.wav$/), '--data-format=LEI16@22050']);
  expect(calls[0].input).toBe('-v Bad hi');
});
it('deletes the temporary file, also when say fails', async () => {
  let out = '';
  const sp = new MacSpeaker({ run: async (_f, args) => { out = args[args.indexOf('-o') + 1]; fs.writeFileSync(out, 'x'); throw new Error('boom'); } });
  expect(await sp.speak('hi')).toBeNull();
  expect(fs.existsSync(out)).toBe(false);
});
it('gives up on a slow sentence', async () => {
  const sp = new MacSpeaker({ timeoutMs: 20, run: () => new Promise(() => {}) });
  expect(await sp.speak('hi')).toBeNull();
});
it('ignores a voice name that is not plain words', () => expect(new MacSpeaker({ voice: 'Fred; rm -rf' }).voice).toBe('Fred'));
```

- [ ] **Step 2:** Run `npx vitest run tests/voice/speaker.test.ts` — Expected: FAIL, module not found.
- [ ] **Step 3: Implement.** Temp path `path.join(os.tmpdir(), 'jev-voice-' + randomUUID() + '.wav')`, unlinked in `finally` (ignore a missing file). Timeout default 5000 ms, enforced with `Promise.race` as well as `execFile`'s own `timeout` (the real runner kills the child). Voice from `opts.voice ?? process.env.SPEAK_VOICE ?? 'Fred'`, accepted only if it matches `/^[A-Za-z][A-Za-z ()]{0,39}$/`. Errors are logged once per failure as `[voice] <message>` and return `null`. `findSpeaker()` returns a `MacSpeaker` when `process.platform === 'darwin'` and `/usr/bin/say` exists, else `null`.
- [ ] **Step 4:** Run the test — Expected: PASS. Then run one real sentence from a scratch script (not a test) and check the clip is about 1–3 s of samples. Then `npm run typecheck && npm test`.
- [ ] **Step 5:** Commit `Turn sentences into speech with the Mac's own voice`, push.

### Task 4: Session speaks the player's answers; wire and server

**Files:** Modify `src/server/wire.ts`, `src/server/session.ts`, `src/server/main.ts`, `src/answer/answerer.ts`; Test `tests/server/session.test.ts`, `tests/server/wire.test.ts`.

**Interfaces:**
- Consumes: `SentenceCutter` (Task 2), `SpeakerLike` (Task 3).
- Produces:
  - `wire.ts`: `TAG_VOICE = 3`; `voiceClip(answerId: number, pcm: Int16Array): Uint8Array` → `[TAG_VOICE, u32 LE answerId, ...Int16 LE]`; `readVoiceClip(bytes: Uint8Array): { answerId: number; pcm: Int16Array }`; `SessionInfo.speech: boolean`; `ServerMsg` adds `{ type: 'hush' }`.
  - `Session` deps gain `speaker?: SpeakerLike | null`; events `'voice'` `(answerId: number, pcm: Int16Array)` and `'hush'` `()`. `info().speech` is `!!speaker`.

- [ ] **Step 1: Write the failing tests** (session tests use a stand-in speaker `{ speak: vi.fn(async (t) => Int16Array.of(t.length)) }`, and an answerer whose `answer` calls `onDelta` with growing text)

```ts
it('speaks each sentence of the player\'s answer, in order', async () => {
  // answerer streams 'Onix is weak to Water.' then 'Onix is weak to Water. Use Bubble.' and returns the latter
  await s.handleText('what is onix weak to', 'human');
  expect(speaker.speak.mock.calls.map((c) => c[0])).toEqual(['Onix is weak to Water.', 'Use Bubble.']);
  expect(voices.map(([, pcm]) => pcm[0])).toEqual([22, 11]); // emitted in order, tagged with the answer's log id
});
it('never speaks an agent\'s question', async () => { await s.handleText('what is onix weak to', 'agent'); expect(speaker.speak).not.toHaveBeenCalled(); });
it('skips a sentence the speaker could not make and carries on', async () => { /* speak returns null for the first */ expect(voices).toHaveLength(1); });
it('speaks the final reply when it replaced what streamed', async () => { /* streams 'Here is. Then', returns "I can't answer that one." */ expect(speaker.speak).toHaveBeenLastCalledWith("I can't answer that one."); expect(hushes).toBe(1); });
it('stop hushes the voice and drops sentences not yet spoken', async () => { /* first speak call waits on a promise; s.stop('human') meanwhile; release */ expect(hushes).toBeGreaterThan(0); expect(speaker.speak).toHaveBeenCalledTimes(1); expect(voices).toHaveLength(0); });
it('a new question cuts off the old answer', async () => { /* second handleText while first speak pending */ expect(spokenFor(firstId)).toHaveLength(0); });
it('reports whether it can speak', () => expect(s.info().speech).toBe(true));
// wire.test.ts
it('round-trips a voice clip', () => { const b = voiceClip(42, Int16Array.of(1, -1)); expect(b[0]).toBe(TAG_VOICE); expect(readVoiceClip(b)).toEqual({ answerId: 42, pcm: Int16Array.of(1, -1) }); });
```

- [ ] **Step 2:** Run `npx vitest run tests/server` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** In the `question` branch, only when `source === 'human'` and a speaker exists: hush any earlier voice (bump a private `voiceGen` and emit `'hush'`), make a `SentenceCutter`, feed every `onDelta` through `push`, and after the answer resolves call `finish(message)` (emit `'hush'` first when `replaced`). Sentences go onto one promise chain per answer; before each `speak` and before each emit, drop it if `voiceGen` changed. `stop(source)` with `source === 'human'` also bumps `voiceGen` and emits `'hush'`. `main.ts`: `findSpeaker()`, pass it in; `session.on('voice', (id, pcm) => broadcastBin(voiceClip(id, pcm)))`; `session.on('hush', () => broadcast({ type: 'hush' }))`; print `Spoken answers: Mac voice <name>` or `Spoken answers: browser voice` at start. Answerer `SYSTEM` gains: `Your answer is read aloud, so write words as they are said (for example "level 12", not "Lv12").`
- [ ] **Step 4:** `npm run typecheck && npm test` — Expected: all green.
- [ ] **Step 5:** Commit `Speak the player's answers: server side`, push.

### Task 5: The page's voice player

**Files:** Create `web/src/voice.ts`; Modify `web/src/audio.ts`; Test `web/src/voice.test.ts`.

**Interfaces:**
- Consumes: `VOICE_RATE` (Task 3, from `wire.ts`).
- Produces:
  - `audio.ts`: `GameAudio` gains `readonly ctx: AudioContext` and `duck(on: boolean)` (a second gain node after the volume gain; `setTargetAtTime` to `DUCK_LEVEL = 0.3` / `1`, time constant 0.1 s ≈ 300 ms to settle).
  - `voice.ts`: `VOICE_FX = { lowCut: 300, highCut: 3400, ringHz: 50, ringMix: 0.35, hold: 2 }` (or the player's numbers from Task 1); `SPEAKING_TAIL_MS = 1500`; `crush(pcm: Int16Array, hold: number): Float32Array`; `class VoicePlayer { constructor(ctx: AudioContextLike, duck: (on: boolean) => void, now?: () => number); enabled: boolean; volume: number; setEnabled(b); setVolume(v); push(pcm: Int16Array): void; stop(): void; get speaking(): boolean; onChange: (() => void) | null }`; `speakFallback(text: string, volume: number): void` and `stopFallback(): void`.
  - `AudioContextLike` is the slice used: `currentTime`, `destination`, `createBuffer`, `createBufferSource`, `createGain`, `createBiquadFilter`, `createOscillator`.

- [ ] **Step 1: Write the failing tests** (`// @vitest-environment jsdom`; a small fake context whose sources record `start(at)` and expose a way to fire `onended`; `now` is a fake clock)

```ts
it('holds every nth sample', () => expect(Array.from(crush(Int16Array.of(32767, 0, -32768, 0), 2))).toEqual([32767/32768, 32767/32768, -1, -1]));
it('plays clips back to back', () => { p.push(clip(22050)); p.push(clip(11025)); expect(starts).toEqual([t0, t0 + 1]); });
it('dips the music while speaking and lifts it after the last clip', () => { p.push(clip(100)); expect(ducks).toEqual([true]); endAll(); expect(ducks).toEqual([true, false]); });
it('counts as speaking for 1.5 s after the last clip', () => { p.push(clip(100)); endAll(); clock += 1499; expect(p.speaking).toBe(true); clock += 2; expect(p.speaking).toBe(false); });
it('ignores clips when Voice is off', () => { p.setEnabled(false); p.push(clip(100)); expect(starts).toEqual([]); });
it('stop cuts the clip and empties the queue', () => { p.push(clip(100)); p.push(clip(100)); p.stop(); expect(stopped).toBe(2); expect(ducks.at(-1)).toBe(false); });
it('remembers the voice switch and volume', () => { p.setVolume(0.4); p.setEnabled(false); const q = new VoicePlayer(fakeCtx(), () => {}); expect(q.volume).toBe(0.4); expect(q.enabled).toBe(false); });
```

- [ ] **Step 2:** Run `npx vitest run web/src/voice.test.ts` — Expected: FAIL, module not found.
- [ ] **Step 3: Implement.** Chain per player (built once): input gain → highpass(`lowCut`) → lowpass(`highCut`) → split into dry gain (`1 - ringMix`) and ring gain (gain param 0, driven by an oscillator at `ringHz` connected to `ringGain.gain`, scaled by `ringMix`) → voice volume gain → `ctx.destination`. Each clip: `crush` then a 1-channel buffer at `VOICE_RATE`, scheduled at `max(now + 0.05, lastEnd)`. Voice volume and switch stored under `voiceVolume` (default 0.8) and `voiceOn` (default 1) with try/catch like `audio.ts`. `speaking` is true while any source is unfinished or `now() < lastEndedAt + SPEAKING_TAIL_MS`; `onChange` fires when playback starts and when the tail ends (a `setTimeout`). `speakFallback` uses `speechSynthesis` with `rate 1.05, pitch 0.6`, sets the same speaking state through `onstart`/`onend`. GameAudio's muted switch does not mute the voice (it is labelled "Game sound"); the Voice switch does.
- [ ] **Step 4:** Run the test — Expected: PASS. Then `npm run typecheck && npm test`.
- [ ] **Step 5:** Commit `Page voice player with the Pokédex effect`, push.

### Task 6: Wiring, Voice switch, dictation guard

**Files:** Modify `web/src/ws.ts`, `web/src/App.tsx`, `web/src/TopBar.tsx`, `web/src/CommandBar.tsx`, `web/src/autoSend.ts`, `web/src/styles.css`, `README.md`; Test `web/src/autoSend.test.ts`.

**Interfaces:**
- Consumes: `readVoiceClip`, `TAG_VOICE`, `hush` (Task 4); `VoicePlayer`, `speakFallback`, `stopFallback` (Task 5); `isStop` (existing).
- Produces: `Connection.onVoice: MutableRefObject<((answerId: number, pcm: Int16Array) => void) | null>` and `onHush` likewise; `AutoSender` constructor gains `hold: () => boolean` and `onDiscard: (text: string) => void` (3rd and 4th arguments, both optional).

- [ ] **Step 1: Write the failing tests** (fake timers)

```ts
it('throws away dictation that lands while the voice is talking', () => {
  let talking = true; const sent: string[] = [], dropped: string[] = [];
  const a = new AutoSender((t) => sent.push(t), isStop, () => talking, (t) => dropped.push(t));
  a.update('go north', 300, true); vi.advanceTimersByTime(300);
  expect(sent).toEqual([]);
  expect(dropped).toEqual(['go north']);
});
it('still sends a dictated stop at once while the voice is talking', () => { /* hold true */ a.update('stop', 300, true); expect(sent).toEqual(['stop']); });
it('sends dictation that lands after the voice is done', () => { talking = false; a.update('go north', 300, true); vi.advanceTimersByTime(300); expect(sent).toEqual(['go north']); });
```

Hold is checked when the timer fires, so text dictated during the 1.5 s tail is also dropped.

- [ ] **Step 2:** Run `npx vitest run web/src/autoSend.test.ts` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - `autoSend.ts`: `hold` checked when the timer fires; held text calls an `onDiscard(text)` callback (4th constructor arg) instead of `send`; urgent text bypasses `hold`.
  - `ws.ts`: `TAG_VOICE` → `onVoice`; `{type:'hush'}` → `onHush`.
  - `App.tsx`: one `VoicePlayer` on `audio.ctx`, `duck` = `audio.duck`; `onVoice` → `voice.push`; `onHush` → `voice.stop(); stopFallback()`. When `session.speech === false`, a finished `answer` log entry from the human (`status 'answer'`, `doneAt` set, not `…`) is read once with `speakFallback` (track spoken ids). Sending any stop (`isStop(text)` or the Stop button) calls `voice.stop()` and `stopFallback()` locally before the message goes out. Re-render on `voice.onChange` so the guard note appears and disappears.
  - `CommandBar.tsx`: new prop `voiceTalking: () => boolean`, passed as `hold`; on discard clear the box and show a small note `Waiting for the voice to finish. Say “stop” to cut it off.` until the next keystroke or send. Text mode unaffected (AutoSender is off there).
  - `TopBar.tsx` Sound menu: checkbox `Read answers aloud` and a `Voice volume` slider, below the game sound controls; the slider is disabled when the switch is off.
  - `README.md`: "Spoken answers" — what is spoken, `SPEAK_VOICE`, Mac vs other computers, the guard, the switch.
- [ ] **Step 4:** `npm run typecheck && npm test` — Expected: all green.
- [ ] **Step 5: See it work.** Start a throwaway server on port 8788 with autosave off (not the player's game), open it in headless Chrome, send `what is onix weak to` over WS, and confirm `TAG_VOICE` clips arrive and the page's `voice.speaking` goes true then false. Hearing it is the player's job; say so.
- [ ] **Step 6:** Commit `Speak answers in the page; Voice switch and dictation guard`, push. Restart the player's server (`kill -TERM` the listener on 8787, wait for the port, `npm start` in the background) so the running app has the feature.
