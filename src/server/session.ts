import { SentenceCutter } from '../voice/sentences.js';
import type { SpeakerLike } from '../voice/speaker.js';
import { EventEmitter } from 'node:events';
import type { Button } from '../emu/emulator.js';
import type { Action, ActionResult } from '../actions/types.js';
import type { GameSnapshot } from '../game/snapshot.js';
import type { Interpreter } from '../interpret/interpreter.js';
import { fastPath, isStop } from '../interpret/fastpath.js';
import { splitParts } from '../interpret/parts.js';
import { nameWords } from '../interpret/name.js';

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
/** How many steps a sentence asks for: a number in it, "all the way" for as far as possible, otherwise one. */
export function stepCount(said: string): number {
  const t = said.toLowerCase();
  // "keep going", "continue", "until something is in the way": walk as far as it goes
  if (/all the way|as far as|\buntil\b|\bkeep (?:on )?(?:going|walking|moving|heading)\b|\bcontinue\b|\bcarry on\b|\bgo on\b/.test(t)) return 20;
  if (/\bcouple\b/.test(t)) return 2;
  if (/\bfew\b|\bseveral\b/.test(t)) return 3;
  const digits = t.match(/\b(\d{1,2})\b/);
  if (digits) return Math.max(1, Math.min(20, +digits[1]));
  for (const w of t.split(/[^a-z]+/)) { const n = NUMBER_WORDS.indexOf(w); if (n >= 1) return n; }
  return 1;
}
import { Slot, type Control } from '../worker/control.js';
import type { Chooser, InputMode, LogEntry, SessionInfo, SetKey, Source } from './wire.js';

/** The part of GameClient the session uses. */
export interface GameLike {
  readonly ctl: Control;
  state: GameSnapshot;
  actions: Action[];
  readonly busy: boolean;
  run(id: string, arg?: unknown): Promise<ActionResult>;
  stop(): void;
  save(name: string): Promise<void>;
  load(name: string): Promise<void>;
  tileAction(col: number, row: number): Promise<string | null>;
  /** the game screen as a PNG (only needed when the model can see) */
  screenPng?(): Promise<Uint8Array>;
}

export interface AnswererLike {
  readonly enabled: boolean;
  answer(question: string, state: GameSnapshot, onDelta?: (soFar: string) => void): Promise<string>;
}

export type Outcome = ActionResult | { status: 'answer' | 'asking' | 'refused' | 'nothing'; message: string };

const JUST_STOPPED: Outcome = { status: 'refused', message: 'The player pressed stop.' };
const BUSY: Outcome = { status: 'refused', message: 'The player is doing something. Wait for it to finish.' };
/** Who picked an action, and how surely when it was a model. */
interface Why { by: Chooser; sure?: number }
const DIRECT: Why = { by: 'direct' };
const PICKED: Why = { by: 'picked' };
const CANCELLED: Outcome = { status: 'stopped', message: 'Cancelled.' };
const QUICK_SAVE = 'quick';

/**
 * One player's sitting: which input mode is on, who has the controls, and the path every command
 * takes (fixed grammar → interpreter → action or answer). Emits 'log' (LogEntry, again whenever an
 * entry changes) and 'session' (SessionInfo).
 */
export class Session extends EventEmitter {
  mode: InputMode = 'voice';
  private nextLog = 1;
  /** an open "did you mean": the log entry that asked, the choices, who was asked and what they had said */
  private pending: { entry: LogEntry; logId: string; choices: Action[]; source: Source; heard: string; at: number } | null = null;
  /** how many of the player's own commands or clicks are still being worked out (waiting on the model or the game thread) */
  private thinking = 0;
  /** An open question to the player holds agents off for this long at most, in case the player walks away from it. */
  static readonly QUESTION_HOLD_MS = 30_000;
  /** the action that is running now: who started it, and whether the player has since taken over */
  private current: { source: Source; takenOver: boolean } | null = null;

  /** How long agents are held off after the player stops, so a looping agent cannot undo the stop at once. */
  static readonly AGENT_HOLD_MS = 5000;
  private agentHoldUntil = 0;
  private now: () => number;
  /** bumped to silence whatever is being spoken */
  private voiceGen = 0;
  /** settles once every sentence queued so far has been spoken or dropped */
  voiceQueue: Promise<void> = Promise.resolve();

  constructor(private deps: { game: GameLike; interpreter: Interpreter; answerer: AnswererLike; jev: 'standin' | 'gateway'; speaker?: SpeakerLike | null; now?: () => number }) {
    super();
    this.now = deps.now ?? Date.now;
  }

  info(): SessionInfo {
    const { ctl } = this.deps.game;
    return {
      mode: this.mode, autoAdvance: ctl.get(Slot.AUTO_ADVANCE) === 1, advancePaceMs: ctl.get(Slot.ADVANCE_PACE_MS),
      speed: ctl.get(Slot.SPEED_X100) / 100, jev: this.deps.jev, answers: this.deps.answerer.enabled, speech: !!this.deps.speaker,
    };
  }

  // ---- log

  private log(source: Source, status: LogEntry['status'], text: string, heard?: string, choices?: LogEntry['choices'], extra: Partial<LogEntry> = {}): LogEntry {
    const entry: LogEntry = { id: String(this.nextLog++), at: Date.now(), source, status, text, ...(heard ? { heard } : {}), ...(choices ? { choices } : {}), ...extra };
    this.emit('log', entry);
    return entry;
  }
  private update(entry: LogEntry, status: LogEntry['status'], text: string) {
    entry.status = status; entry.text = text;
    if (status !== 'running' && entry.doneAt === undefined) entry.doneAt = this.now();
    this.emit('log', entry);
  }

  /** A short reminder of what is possible here, for when a command could not be matched. */
  private hint(): string {
    const acts = this.deps.game.actions;
    const things = acts.filter((a) => a.kind !== 'press' && a.kind !== 'steps' && a.kind !== 'item').slice(0, 5).map((a) => a.label);
    const walk = acts.some((a) => a.kind === 'steps') ? ['step up, down, left or right'] : [];
    const all = [...things, ...walk];
    return all.length ? ` Here you can: ${all.join(' · ')}.` : '';
  }

  // ---- who may act

  /** Why this source may not act right now, or null if it may. The player always may. */
  private refusal(source: Source): Outcome | null {
    if (source === 'human') return null;
    if (this.now() < this.agentHoldUntil) return JUST_STOPPED;
    // the player comes first: an agent never replaces what the player started, is holding, is waiting on, or has been asked
    if (this.current?.source === 'human' || this.deps.game.ctl.get(Slot.HELD) !== 0 || this.thinking > 0) return BUSY;
    if (this.pending?.source === 'human' && this.now() - this.pending.at < Session.QUESTION_HOLD_MS) return BUSY;
    return null;
  }
  private mayAct(source: Source): boolean { return this.refusal(source) === null; }

  // ---- spoken answers

  /** Silence the voice: sentences not yet spoken are dropped and the pages stop playing. */
  private hush() {
    this.voiceGen++;
    this.emit('hush');
  }

  /**
   * Speaks an answer as it streams in, a sentence at a time. Emits 'voice' (answerId, pcm) for each.
   * Null when there is no speaker. A newer answer or a stop silences it.
   */
  private speakAnswer(answerId: number): { push(soFar: string): void; finish(final: string): void } | null {
    const speaker = this.deps.speaker;
    if (!speaker) return null;
    this.hush();
    let g = this.voiceGen;
    const cutter = new SentenceCutter();
    const queue = (sentences: string[]) => {
      for (const s of sentences) {
        this.voiceQueue = this.voiceQueue.then(async () => {
          if (g !== this.voiceGen) return;
          const pcm = await speaker.speak(s).catch(() => null);
          if (pcm && pcm.length && g === this.voiceGen) this.emit('voice', answerId, pcm);
        });
      }
    };
    return {
      push: (soFar) => queue(cutter.push(soFar)),
      finish: (final) => {
        const { sentences, replaced } = cutter.finish(final);
        if (g !== this.voiceGen) return;
        // the final answer is not what streamed (a refusal, a failure): say it instead of what was queued
        if (replaced) { this.hush(); g = this.voiceGen; }
        queue(sentences);
      },
    };
  }

  /** Close an open "did you mean" that will not be answered, so the page stops offering it. */
  private dropPending() {
    const p = this.pending;
    this.pending = null;
    if (p && p.entry.status === 'asking') this.update(p.entry, 'stopped', 'Question dropped.');
  }

  /**
   * Counts commands. Anything that should supersede a command still being worked out (stop, a newer
   * command, a button press, a mode change) bumps it; the older command sees the change and gives up.
   */
  private gen = 0;
  /** Counts everything that should end a chain of commands in progress: a stop, a button, a click, a new command or action. */
  private bumps = 0;
  /** The most actions one command may take when the model keeps finding a next step. */
  static readonly MAX_ROUNDS = 8;

  /** A human doing anything takes the controls back from an agent's running action. */
  private takeOver(source: Source) {
    if (source === 'human' && this.current?.source === 'agent') this.current.takenOver = true;
  }

  stop(source: Source): void {
    this.bumps++;
    if (source === 'human') { this.agentHoldUntil = this.now() + Session.AGENT_HOLD_MS; this.hush(); }
    this.gen++;
    this.deps.game.stop();
  }

  set(key: SetKey, value: unknown): void {
    const { ctl } = this.deps.game;
    if (key === 'mode') {
      if (this.mode === value) return;
      this.gen++;
      this.mode = value as InputMode;
    } else if (key === 'autoAdvance') ctl.set(Slot.AUTO_ADVANCE, value ? 1 : 0);
    else if (key === 'advancePaceMs') ctl.set(Slot.ADVANCE_PACE_MS, Number(value));
    else if (key === 'speed') ctl.set(Slot.SPEED_X100, Math.round(Number(value) * 100));
    this.emit('session', this.info());
  }

  /** Keyboard and on-screen buttons. Always the human's; stops whatever is running first. */
  rawButton(kind: 'down' | 'up' | 'tap', button: Button): void {
    const { game } = this.deps;
    if (kind === 'up') { game.ctl.release(button); return; }
    this.gen++; this.bumps++;
    this.dropPending(); // the screen is about to change under any open "did you mean"
    if (game.busy) { this.takeOver('human'); game.stop(); }
    game.ctl.press(button);
    if (kind === 'tap') setTimeout(() => game.ctl.release(button), 100);
  }

  // ---- doing things

  private async exec(action: { id: string; label: string; distance?: number }, source: Source, arg: unknown, heard: string | undefined, note = '', why: Why = DIRECT): Promise<ActionResult> {
    const { game } = this.deps;
    this.takeOver(source);
    const steps = action.distance ? ` (${action.distance} ${action.distance === 1 ? 'step' : 'steps'})` : '';
    const entry = this.log(source, 'running', `${action.label}${steps}${note}`, heard, undefined, { chose: action.label, by: why.by, ...(why.sure !== undefined ? { sure: why.sure } : {}) });
    const mine = { source, takenOver: false };
    this.current = mine;
    let r: ActionResult;
    try {
      r = await game.run(action.id, arg);
    } catch (e) {
      r = { status: 'failed', message: (e as Error).message };
    }
    if (mine.takenOver) r = { status: 'interrupted', message: 'Interrupted by the player.' };
    if (this.current === mine) this.current = null;
    const shown = r.status === 'done' || r.status === 'prompt' ? 'done' : r.status === 'stopped' ? 'stopped' : 'failed';
    this.update(entry, shown, `${entry.text} → ${r.message}`);
    return r;
  }

  /** Run a listed action by id (an agent's do_action, or anything already resolved). */
  async runAction(id: string, source: Source, arg?: unknown): Promise<Outcome> {
    const no = this.refusal(source);
    if (no) return no;
    this.gen++; this.bumps++;
    this.dropPending();
    const a = this.deps.game.actions.find((x) => x.id === id);
    return this.exec(a ?? { id, label: id }, source, arg, undefined);
  }

  /** Tap buttons one after another (an agent's raw input). */
  async press(buttons: Button[], source: Source): Promise<Outcome> {
    const no = this.refusal(source);
    if (no) return no;
    this.gen++; this.bumps++;
    this.dropPending();
    let r: Outcome = { status: 'nothing', message: '' };
    for (const b of buttons) {
      r = await this.exec({ id: `press:${b}`, label: `Press ${b}` }, source, undefined, undefined);
      if (r.status !== 'done') break;
    }
    return r;
  }

  /** Named save and load. Loading replaces the game in progress, so it needs the controls. */
  async saveState(name: string, source: Source): Promise<Outcome> {
    const no = this.refusal(source);
    if (no) return no;
    await this.deps.game.save(name);
    this.log(source, 'info', `Saved "${name}".`);
    return { status: 'done', message: `Saved "${name}".` };
  }
  async loadState(name: string, source: Source): Promise<Outcome> {
    const no = this.refusal(source);
    if (no) return no;
    this.gen++;
    try { await this.deps.game.load(name); } catch (e) { return { status: 'failed', message: (e as Error).message }; }
    this.log(source, 'info', `Loaded "${name}".`);
    return { status: 'done', message: `Loaded "${name}".` };
  }

  /** A question for the answerer. Never touches the game, so anyone may ask in any mode. */
  ask(text: string): Promise<string> {
    return this.deps.answerer.answer(text, this.deps.game.state);
  }

  /** A click on the game screen: walk there, or interact with what is there. */
  async click(col: number, row: number): Promise<Outcome> {
    this.thinking++;
    try { return await this.clickInner(col, row); } finally { this.thinking--; }
  }
  private async clickInner(col: number, row: number): Promise<Outcome> {
    const { game } = this.deps;
    const g = ++this.gen; this.bumps++;
    // The game thread can only say what a click means between actions, so whatever is running (the
    // player's own walk, or an agent's action) is stopped first. The click then means what is on screen.
    if (game.busy) { this.takeOver('human'); game.stop(); }
    const id = await game.tileAction(col, row);
    if (g !== this.gen) return CANCELLED;
    if (!id) return { status: 'nothing', message: "Can't walk right now." };
    this.dropPending();
    const a = this.deps.game.actions.find((x) => x.id === id);
    return this.exec(a ?? { id, label: 'Walk there' }, 'human', undefined, undefined);
  }

  /** An answer to a "did you mean" question, by click or key. */
  async choose(logId: string, index: number, source: Source): Promise<Outcome> {
    const no = this.refusal(source);
    if (no) return no;
    this.gen++;
    const p = this.pending;
    if (!p || p.logId !== logId || !p.choices[index]) return { status: 'nothing', message: 'That question is no longer open.' };
    this.pending = null;
    return this.exec(p.choices[index], source, undefined, p.heard, '', PICKED);
  }

  /** A typed or dictated command, from the player or from an agent. */
  async handleText(text: string, source: Source): Promise<Outcome> {
    this.bumps++;
    if (source !== 'human') return this.handleParts(text, source);
    this.thinking++;
    try { return await this.handleParts(text, source); } finally { this.thinking--; }
  }

  /**
   * One sentence can hold several commands ("get around the boy and continue east"). Each part is carried
   * out in turn as a command of its own, and the chain ends at the first part that does not simply finish:
   * a question from the game, a failure, a "did you mean", a stop, or anything else the player does meanwhile.
   */
  private async handleParts(text: string, source: Source): Promise<Outcome> {
    const parts = isStop(text) ? [] : splitParts(text);
    if (parts.length <= 1) return this.handleTextInner(text, source);
    const mark = this.bumps;
    let r: Outcome = { status: 'nothing', message: '' };
    for (const part of parts) {
      r = await this.handleTextInner(part, source);
      if (r.status !== 'done' || this.bumps !== mark) break;
    }
    return r;
  }
  private async handleTextInner(text: string, source: Source): Promise<Outcome> {
    const { game, interpreter, answerer } = this.deps;
    const said = text.trim();
    if (!said) return { status: 'nothing', message: '' };
    const no = this.refusal(source);
    if (no) return no;

    const has = (id: string) => game.actions.some((a) => a.id === id);
    const fast = fastPath(said, has, this.pending !== null);

    // this command now supersedes any older one still being worked out
    const g = ++this.gen;
    /** True if a stop, a newer command, a button or a mode change arrived while we were waiting. */
    const superseded = () => g !== this.gen;

    if (fast) {
      switch (fast.kind) {
        case 'stop': this.stop(source); return { status: 'stopped', message: 'Stopped.' };
        case 'set':
          this.set(fast.key, fast.value);
          this.log(source, 'info', fast.key === 'mode' ? `${fast.value[0].toUpperCase()}${fast.value.slice(1)} mode.` : `Auto-advance ${fast.value ? 'on' : 'off'}.`, said);
          return { status: 'done', message: 'OK.' };
        case 'save': case 'load': {
          const entry = this.log(source, 'running', fast.kind === 'save' ? 'Saving…' : 'Loading…', said);
          try {
            await (fast.kind === 'save' ? game.save(QUICK_SAVE) : game.load(QUICK_SAVE));
            this.update(entry, 'done', fast.kind === 'save' ? 'Saved.' : 'Loaded.');
            return { status: 'done', message: entry.text };
          } catch (e) {
            this.update(entry, 'failed', fast.kind === 'load' ? 'There is no quick save to load yet.' : (e as Error).message);
            return { status: 'failed', message: entry.text };
          }
        }
        case 'pick': {
          const p = this.pending;
          if (!p?.choices[fast.index]) return { status: 'nothing', message: 'There is no such choice.' };
          this.pending = null;
          return this.exec(p.choices[fast.index], source, undefined, said, '', PICKED);
        }
        case 'run': {
          this.dropPending();
          const a = game.actions.find((x) => x.id === fast.id);
          return this.exec(a ?? { id: fast.id, label: fast.id }, source, fast.arg, said);
        }
      }
    }

    this.dropPending();
    // the real Jev is shown the game screen along with the facts; the stand-in cannot see, so no picture is taken for it
    const sees = this.deps.jev === 'gateway' && process.env.JEV_SEES_SCREEN !== '0';
    const image = sees && game.screenPng ? await game.screenPng().catch(() => undefined) : undefined;
    const first = await interpreter.interpret(said, game.actions, game.state, { image });
    if (superseded()) { this.log(source, 'stopped', 'Cancelled.', said); return CANCELLED; }
    const stillNo = this.refusal(source);
    if (stillNo) return stillNo;
    const note = first.fellBack ? ' (Jev unavailable, used the stand-in)' : '';
    const chooser = (i: { backend: string; fellBack: boolean }): Chooser => (i.backend === 'gateway' && !i.fellBack ? 'jev' : 'standin');

    // A naming screen has one thing to do: type a name. The model can choose that but cannot write the
    // name, so unless the player asked a question, the name is lifted from their own words.
    const naming = game.actions.find((a) => a.id === 'name');
    if (naming && first.kind !== 'question' && first.kind !== 'nothing') {
      const words = nameWords(said);
      if (!words.length) {
        const message = 'Which name? Say just the name, like "Leo".';
        this.log(source, 'failed', message, said);
        return { status: 'failed', message };
      }
      return this.exec({ ...naming, label: `Type ${words.join('').toUpperCase()}` }, source, { text: words.join('') }, said, note, { by: chooser(first) });
    }
    switch (first.kind) {
      case 'nothing': {
        if (first.reason === 'empty') return { status: 'nothing', message: '' };
        const message = first.reason === 'long' ? "That's too long to be a command. Say one thing at a time." : "Can't do that right now.";
        this.log(source, 'failed', message, said);
        return { status: 'failed', message };
      }
      case 'impossible': {
        const message = 'I can only do things you can do from here.';
        this.log(source, 'failed', `${message}${this.hint()}${note}`, said);
        return { status: 'failed', message };
      }
      case 'question': {
        const entry = this.log(source, 'answer', '…', said);
        const say = source === 'human' ? this.speakAnswer(Number(entry.id)) : null;
        const message = await answerer.answer(said, game.state, (soFar) => { this.update(entry, 'answer', soFar); say?.push(soFar); });
        this.update(entry, 'answer', message);
        say?.finish(message);
        return { status: 'answer', message };
      }
      case 'clarify': {
        if (!first.options.length) {
          const message = 'I can only do things you can do from here.';
          this.log(source, 'failed', message + note, said);
          return { status: 'failed', message };
        }
        const entry = this.log(source, 'asking', `Did you mean…${note}`, said, first.options.map((o) => ({ id: o.id, label: o.label })));
        this.pending = { entry, logId: entry.id, choices: first.options, source, heard: said, at: this.now() };
        return { status: 'asking', message: `Did you mean: ${first.options.map((o, i) => `${i + 1}) ${o.label}`).join('  ')}` };
      }
      case 'act': {
        const arg = first.action.kind === 'steps' ? stepCount(said) : undefined;
        let r = await this.exec(first.action, source, arg, said, note, { by: chooser(first), sure: first.p });
        // Opening a menu (FIGHT, the bag, the START menu) is the whole command: what to pick inside is the player's call.
        const opener = first.action.id.startsWith('battle:') || first.action.id === 'start' || first.action.id.startsWith('startmenu:');
        if (r.status === 'prompt' && !opener) {
          // The game asked something. If the same sentence already answers it ("use potion ON PIKACHU"),
          // carry on, but only on a strong match, and only this once.
          // (a naming screen: the name is in the player's own words, e.g. "new name SHIGERU")
          const nowNaming = game.actions.find((a) => a.id === 'name');
          if (nowNaming && !superseded() && !this.refusal(source)) {
            const done = new Set(first.action.label.toLowerCase().split(/[^a-z]+/));
            const words = nameWords(said).filter((w) => !done.has(w.toLowerCase()));
            return words.length ? this.exec({ ...nowNaming, label: `Type ${words.join('').toUpperCase()}` }, source, { text: words.join('') }, said, '', { by: chooser(first) }) : r;
          }
          const again = await interpreter.interpret(said, game.actions, game.state, { strict: true, justDid: first.action.label });
          if (!superseded() && !this.refusal(source) && again.kind === 'act' && again.action.id !== first.action.id) r = await this.exec(again.action, source, undefined, said, '', { by: chooser(again), sure: again.p });
        }
        // A command can need more than one action ("go round the boy to the sign"). After each one the model
        // is asked what, if anything, comes next, and it may say everything is done. It never repeats an
        // action, never goes on into something hard to undo, and never goes past anything the game asks.
        const did = [first.action];
        while (r.status === 'done' && did.length < Session.MAX_ROUNDS && !superseded() && !this.refusal(source)) {
          const next = await interpreter.interpret(said, game.actions, game.state, { progress: did.map((a) => a.label) });
          if (superseded() || this.refusal(source)) break;
          if (next.kind !== 'act' || next.action.costly || did.some((a) => a.id === next.action.id)) break;
          did.push(next.action);
          r = await this.exec(next.action, source, next.action.kind === 'steps' ? stepCount(said) : undefined, said, '', { by: chooser(next), sure: next.p });
        }
        return r;
      }
      case 'done': return { status: 'nothing', message: '' };
    }
  }
}
