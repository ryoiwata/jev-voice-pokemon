import { EventEmitter } from 'node:events';
import type { Button } from '../emu/emulator.js';
import type { Action, ActionResult } from '../actions/types.js';
import type { GameSnapshot } from '../game/snapshot.js';
import type { Interpreter } from '../interpret/interpreter.js';
import { fastPath } from '../interpret/fastpath.js';
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
}

export interface AnswererLike {
  readonly enabled: boolean;
  answer(question: string, state: GameSnapshot, onDelta?: (soFar: string) => void): Promise<string>;
}

export type Outcome = ActionResult | { status: 'answer' | 'asking' | 'refused' | 'nothing'; message: string };

const REFUSED: Outcome = { status: 'refused', message: 'The player has the controls.' };
const AGENT_MODE_ONLY: Outcome = { status: 'refused', message: 'Agent mode: say "stop" or "voice mode" to take over.' };
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

  // ---- who may act

  private mayAct(source: Source): boolean {
    return source === 'human' || this.mode === 'agent';
  }

  /** A human doing anything takes the controls back from an agent's running action. */
  private takeOver(source: Source) {
    if (source === 'human' && this.current?.source === 'agent') this.current.takenOver = true;
  }

  stop(_source: Source): void {
    this.deps.game.stop();
  }

  set(key: SetKey, value: unknown): void {
    const { ctl } = this.deps.game;
    if (key === 'mode') {
      if (this.mode === value) return;
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
    if (!this.mayAct(source)) return REFUSED;
    this.pending = null;
    const a = this.deps.game.actions.find((x) => x.id === id);
    return this.exec(a ?? { id, label: id }, source, arg, undefined);
  }

  /** A click on the game screen: walk there, or interact with what is there. */
  async click(col: number, row: number): Promise<Outcome> {
    const id = await this.deps.game.tileAction(col, row);
    if (!id) return { status: 'nothing', message: "Can't walk right now." };
    this.pending = null;
    const a = this.deps.game.actions.find((x) => x.id === id);
    return this.exec(a ?? { id, label: 'Walk there' }, 'human', undefined, undefined);
  }

  /** An answer to a "did you mean" question, by click or key. */
  async choose(logId: string, index: number, source: Source): Promise<Outcome> {
    if (!this.mayAct(source)) return REFUSED;
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
    if (!this.mayAct(source)) return REFUSED;

    const has = (id: string) => game.actions.some((a) => a.id === id);
    const fast = fastPath(said, has, this.pending !== null);

    if (source === 'human' && this.mode === 'agent') {
      // the agent has the controls: the player can only stop it or take them back
      const takesOver = fast && (fast.kind === 'stop' || (fast.kind === 'set' && fast.key === 'mode'));
      if (!takesOver) return AGENT_MODE_ONLY;
    }

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
    const first = await interpreter.interpret(said, game.actions, game.state);
    const note = first.fellBack ? ' (Jev unavailable, used the stand-in)' : '';
    switch (first.kind) {
      case 'nothing': {
        if (first.reason === 'empty') return { status: 'nothing', message: '' };
        const message = "Can't do that right now.";
        this.log(source, 'failed', message, said);
        return { status: 'failed', message };
      }
      case 'impossible': {
        const message = 'I can only do things you can do from here.';
        this.log(source, 'failed', message + note, said);
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
        let r = await this.exec(first.action, source, undefined, said, note);
        if (r.status === 'prompt') {
          // The game asked something. If the same sentence already answers it ("use potion ON PIKACHU"),
          // carry on, but only on a strong match, and only this once.
          const again = await interpreter.interpret(said, game.actions, game.state, { strict: true });
          if (again.kind === 'act' && again.action.id !== first.action.id) r = await this.exec(again.action, source, undefined, undefined);
        }
        return r;
      }
    }
  }
}
