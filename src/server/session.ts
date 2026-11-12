import { EventEmitter } from 'node:events';
import type { Button } from '../emu/emulator.js';
import type { Action, ActionResult } from '../actions/types.js';
import type { GameSnapshot } from '../game/snapshot.js';
import type { Interpreter } from '../interpret/interpreter.js';
import { fastPath } from '../interpret/fastpath.js';
import { nameWords } from '../interpret/name.js';

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
/** How many steps a sentence asks for: a number in it, "all the way" for as far as possible, otherwise one. */
export function stepCount(said: string): number {
  const t = said.toLowerCase();
  if (/all the way|as far as|until .*(wall|stop|end)/.test(t)) return 20;
  if (/\bcouple\b/.test(t)) return 2;
  if (/\bfew\b|\bseveral\b/.test(t)) return 3;
  const digits = t.match(/\b(\d{1,2})\b/);
  if (digits) return Math.max(1, Math.min(20, +digits[1]));
  for (const w of t.split(/[^a-z]+/)) { const n = NUMBER_WORDS.indexOf(w); if (n >= 1) return n; }
  return 1;
}
import { Slot, type Control } from '../worker/control.js';
import type { InputMode, LogEntry, SessionInfo, SetKey, Source } from './wire.js';

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

const REFUSED: Outcome = { status: 'refused', message: 'The player has the controls.' };
const AGENT_MODE_ONLY: Outcome = { status: 'refused', message: 'Agent mode: say "stop" or "voice mode" to take over.' };
const BUSY: Outcome = { status: 'refused', message: 'The player is doing something. Wait for it to finish.' };
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
  private pending: { logId: string; choices: Action[] } | null = null;
  /** the action that is running now: who started it, and whether the player has since taken over */
  private current: { source: Source; takenOver: boolean } | null = null;

  constructor(private deps: { game: GameLike; interpreter: Interpreter; answerer: AnswererLike; jev: 'standin' | 'gateway' }) {
    super();
  }

  info(): SessionInfo {
    const { ctl } = this.deps.game;
    return {
      mode: this.mode, autoAdvance: ctl.get(Slot.AUTO_ADVANCE) === 1, advancePaceMs: ctl.get(Slot.ADVANCE_PACE_MS),
      speed: ctl.get(Slot.SPEED_X100) / 100, jev: this.deps.jev, answers: this.deps.answerer.enabled,
    };
  }

  // ---- log

  private log(source: Source, status: LogEntry['status'], text: string, heard?: string, choices?: LogEntry['choices']): LogEntry {
    const entry: LogEntry = { id: String(this.nextLog++), at: Date.now(), source, status, text, ...(heard ? { heard } : {}), ...(choices ? { choices } : {}) };
    this.emit('log', entry);
    return entry;
  }
  private update(entry: LogEntry, status: LogEntry['status'], text: string) {
    entry.status = status; entry.text = text;
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
    if (this.mode !== 'agent') return REFUSED;
    // even in agent mode the player comes first: an agent never replaces what the player started or is holding
    if (this.current?.source === 'human' || this.deps.game.ctl.get(Slot.HELD) !== 0) return BUSY;
    return null;
  }
  private mayAct(source: Source): boolean { return this.refusal(source) === null; }

  /**
   * Counts commands. Anything that should supersede a command still being worked out (stop, a newer
   * command, a button press, a mode change) bumps it; the older command sees the change and gives up.
   */
  private gen = 0;

  /** A human doing anything takes the controls back from an agent's running action. */
  private takeOver(source: Source) {
    if (source === 'human' && this.current?.source === 'agent') this.current.takenOver = true;
  }

  stop(_source: Source): void {
    this.gen++;
    this.deps.game.stop();
  }

  set(key: SetKey, value: unknown): void {
    const { ctl } = this.deps.game;
    if (key === 'mode') {
      if (this.mode === value) return;
      this.gen++;
      this.mode = value as InputMode;
      // leaving agent mode takes the controls back straight away
      if (this.mode !== 'agent' && this.current?.source === 'agent') { this.current.takenOver = true; this.deps.game.stop(); }
    } else if (key === 'autoAdvance') ctl.set(Slot.AUTO_ADVANCE, value ? 1 : 0);
    else if (key === 'advancePaceMs') ctl.set(Slot.ADVANCE_PACE_MS, Number(value));
    else if (key === 'speed') ctl.set(Slot.SPEED_X100, Math.round(Number(value) * 100));
    this.emit('session', this.info());
  }

  /** Keyboard and on-screen buttons. Always the human's; stops whatever is running first. */
  rawButton(kind: 'down' | 'up' | 'tap', button: Button): void {
    const { game } = this.deps;
    if (kind === 'up') { game.ctl.release(button); return; }
    this.gen++;
    this.pending = null; // the screen is about to change under any open "did you mean"
    if (game.busy) { this.takeOver('human'); game.stop(); }
    game.ctl.press(button);
    if (kind === 'tap') setTimeout(() => game.ctl.release(button), 100);
  }

  // ---- doing things

  private async exec(action: { id: string; label: string; distance?: number }, source: Source, arg: unknown, heard: string | undefined, note = ''): Promise<ActionResult> {
    const { game } = this.deps;
    this.takeOver(source);
    const steps = action.distance ? ` (${action.distance} ${action.distance === 1 ? 'step' : 'steps'})` : '';
    const entry = this.log(source, 'running', `${action.label}${steps}${note}`, heard);
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
    this.gen++;
    this.pending = null;
    const a = this.deps.game.actions.find((x) => x.id === id);
    return this.exec(a ?? { id, label: id }, source, arg, undefined);
  }

  /** Tap buttons one after another (an agent's raw input). */
  async press(buttons: Button[], source: Source): Promise<Outcome> {
    const no = this.refusal(source);
    if (no) return no;
    this.gen++;
    this.pending = null;
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
    const { game } = this.deps;
    const g = ++this.gen;
    // The game thread can only say what a click means between actions, so whatever is running (the
    // player's own walk, or an agent's action) is stopped first. The click then means what is on screen.
    if (game.busy) { this.takeOver('human'); game.stop(); }
    const id = await game.tileAction(col, row);
    if (g !== this.gen) return CANCELLED;
    if (!id) return { status: 'nothing', message: "Can't walk right now." };
    this.pending = null;
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
    return this.exec(p.choices[index], source, undefined, undefined);
  }

  /** A typed or dictated command, from the player or (in agent mode) from an agent. */
  async handleText(text: string, source: Source): Promise<Outcome> {
    const { game, interpreter, answerer } = this.deps;
    const said = text.trim();
    if (!said) return { status: 'nothing', message: '' };
    const no = this.refusal(source);
    if (no) return no;

    const has = (id: string) => game.actions.some((a) => a.id === id);
    const fast = fastPath(said, has, this.pending !== null);

    if (source === 'human' && this.mode === 'agent') {
      // the agent has the controls: the player can only stop it or take them back
      const takesOver = fast && (fast.kind === 'stop' || (fast.kind === 'set' && fast.key === 'mode'));
      if (!takesOver) { this.log(source, 'failed', AGENT_MODE_ONLY.message, said); return AGENT_MODE_ONLY; }
    }
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
          return this.exec(p.choices[fast.index], source, undefined, said);
        }
        case 'run': {
          this.pending = null;
          const a = game.actions.find((x) => x.id === fast.id);
          return this.exec(a ?? { id: fast.id, label: fast.id }, source, fast.arg, said);
        }
      }
    }

    this.pending = null;
    // the real Jev is shown the game screen along with the facts; the stand-in cannot see, so no picture is taken for it
    const sees = this.deps.jev === 'gateway' && process.env.JEV_SEES_SCREEN !== '0';
    const image = sees && game.screenPng ? await game.screenPng().catch(() => undefined) : undefined;
    const first = await interpreter.interpret(said, game.actions, game.state, { image });
    if (superseded()) { this.log(source, 'stopped', 'Cancelled.', said); return CANCELLED; }
    const stillNo = this.refusal(source);
    if (stillNo) return stillNo;
    const note = first.fellBack ? ' (Jev unavailable, used the stand-in)' : '';

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
      return this.exec({ ...naming, label: `Type ${words.join('').toUpperCase()}` }, source, { text: words.join('') }, said, note);
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
        const message = await answerer.answer(said, game.state, (soFar) => this.update(entry, 'answer', soFar));
        this.update(entry, 'answer', message);
        return { status: 'answer', message };
      }
      case 'clarify': {
        if (!first.options.length) {
          const message = 'I can only do things you can do from here.';
          this.log(source, 'failed', message + note, said);
          return { status: 'failed', message };
        }
        const entry = this.log(source, 'asking', `Did you mean…${note}`, said, first.options.map((o) => ({ id: o.id, label: o.label })));
        this.pending = { logId: entry.id, choices: first.options };
        return { status: 'asking', message: `Did you mean: ${first.options.map((o, i) => `${i + 1}) ${o.label}`).join('  ')}` };
      }
      case 'act': {
        const arg = first.action.kind === 'steps' ? stepCount(said) : undefined;
        let r = await this.exec(first.action, source, arg, said, note);
        // Opening a menu (FIGHT, the bag, the START menu) is the whole command: what to pick inside is the player's call.
        const opener = first.action.id.startsWith('battle:') || first.action.id === 'start';
        if (r.status === 'prompt' && !opener) {
          // The game asked something. If the same sentence already answers it ("use potion ON PIKACHU"),
          // carry on, but only on a strong match, and only this once.
          // (a naming screen: the name is in the player's own words, e.g. "new name SHIGERU")
          const nowNaming = game.actions.find((a) => a.id === 'name');
          if (nowNaming && !superseded() && !this.refusal(source)) {
            const done = new Set(first.action.label.toLowerCase().split(/[^a-z]+/));
            const words = nameWords(said).filter((w) => !done.has(w.toLowerCase()));
            return words.length ? this.exec({ ...nowNaming, label: `Type ${words.join('').toUpperCase()}` }, source, { text: words.join('') }, undefined) : r;
          }
          const again = await interpreter.interpret(said, game.actions, game.state, { strict: true, justDid: first.action.label });
          if (!superseded() && !this.refusal(source) && again.kind === 'act' && again.action.id !== first.action.id) r = await this.exec(again.action, source, undefined, undefined);
        }
        return r;
      }
    }
  }
}
