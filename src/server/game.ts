import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import type { GameSnapshot } from '../game/snapshot.js';
import type { Action, ActionResult } from '../actions/types.js';
import { Control, Slot } from '../worker/control.js';

const EMPTY: GameSnapshot = {
  mode: 'boot', map: '', x: 0, y: 0, facing: '?', money: 0, badges: 0, pokedex: { seen: 0, owned: 0 }, playTime: '0:00',
  party: [], bag: [], battle: null, dialog: '', running: null,
};

/**
 * The main thread's handle on the game. The game itself lives in a worker thread.
 * Events: 'frame' (Uint8Array: one byte of buttons held, then rgba 160x144), 'audio' (Int16Array stereo interleaved), 'state', 'actions', 'log'.
 */
export class GameClient extends EventEmitter {
  readonly ctl = new Control();
  state: GameSnapshot = EMPTY;
  actions: Action[] = [];
  private worker!: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private current: Promise<ActionResult> | null = null;

  static start(opts: { romPath: string; resume?: string; autosave?: boolean }): Promise<GameClient> {
    const g = new GameClient();
    return new Promise((resolve, reject) => {
      g.worker = new Worker(new URL('../worker/game-worker.ts', import.meta.url), {
        workerData: { sab: g.ctl.sab, romPath: opts.romPath, resume: opts.resume, autosave: opts.autosave ?? true },
        execArgv: ['--import', 'tsx'],
      });
      g.worker.on('error', (e: unknown) => { reject(e); g.died(e instanceof Error ? e.message : String(e)); });
      g.worker.on('exit', () => { if (!g.closing) g.died('its thread exited'); });
      g.worker.on('message', (m: any) => {
        switch (m.type) {
          case 'ready': resolve(g); break;
          case 'frame': g.emit('frame', m.frame); break;
          case 'audio': g.emit('audio', m.samples); break;
          case 'state': g.state = m.state; g.emit('state', m.state); break;
          case 'actions': g.actions = m.actions; g.emit('actions', m.actions); break;
          case 'log': g.emit('log', m.kind, m.msg); break;
          case 'reply': {
            const p = g.pending.get(m.id); g.pending.delete(m.id);
            if (p) m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
          }
        }
      });
    });
  }

  private closing = false;
  private dead: string | null = null;
  /** The game thread is gone: fail everything that is waiting on it and say so, instead of hanging forever. */
  private died(why: string) {
    if (this.dead) return;
    this.dead = why;
    const err = new Error(`The game stopped unexpectedly (${why}). Restart the app.`);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.current = null;
    this.emit('crashed', err.message);
  }

  private call<T>(op: string, args: unknown = {}): Promise<T> {
    if (this.dead) return Promise.reject(new Error(`The game stopped unexpectedly (${this.dead}). Restart the app.`));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, args });
    });
  }

  /** Carry out one action. A new one replaces whatever is running. */
  async run(id: string, arg?: unknown): Promise<ActionResult> {
    while (this.current) { this.stop(); await this.current.catch(() => {}); }
    const p = this.call<ActionResult>('run', { id, arg });
    this.current = p;
    try { return await p; } finally { if (this.current === p) this.current = null; }
  }

  get busy(): boolean { return this.current !== null; }

  /** Halt the running action, if any. Safe to call any time. */
  stop(): void {
    if (this.current) this.ctl.set(Slot.STOP, 1);
  }

  /** Which action a click on screen tile (col 0-9, row 0-8) means, or null when the player can't walk. */
  tileAction(col: number, row: number): Promise<string | null> { return this.call('tile', { col, row }); }

  save(name: string): Promise<void> { return this.call('save', { name }); }

  async load(name: string): Promise<void> {
    if (this.current) { this.stop(); await this.current.catch(() => {}); }
    await this.call('load', { name });
  }

  async screenPng(): Promise<Buffer> { return Buffer.from(await this.call<Uint8Array>('screenPng')); }

  async shutdown(): Promise<void> {
    this.closing = true;
    if (this.dead) return;
    this.stop();
    const exited = new Promise((r) => this.worker.once('exit', r));
    this.worker.postMessage({ id: this.nextId++, op: 'shutdown', args: {} });
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    await this.worker.terminate();
  }
}
