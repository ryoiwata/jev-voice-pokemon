import fs from 'node:fs';
import path from 'node:path';
import type { JevBackend, JevQuestion, JevInput, JevAnswer } from './types.js';
import { StandinJev } from './standin.js';
import { GatewayJev, typesafeKey } from './gateway.js';

export interface JevCallRecord {
  n: number; at: number; purpose: string; latencyMs: number; backend: string; sawScreen: boolean;
  state: JevInput; questions: Record<string, JevQuestion>; answers: Record<string, JevAnswer>; inputTokens: number;
}

/**
 * Throttled, logged Jev client.
 * - minIntervalMs / maxPerMinute: a hard budget, so a stuck loop can never run up a bill
 * - every call is appended to logs/jev-calls.jsonl (what was said, the options, the probabilities)
 */
export class Jev {
  readonly backend: JevBackend;
  calls = 0;
  inputTokens = 0;
  minIntervalMs: number;
  maxPerMinute: number;
  private retries: number;
  private last = 0;
  private window: number[] = [];
  private log: fs.WriteStream | null = null;

  constructor(opts: { mode?: string; backend?: JevBackend; minIntervalMs?: number; maxPerMinute?: number; retries?: number; logFile?: string | null } = {}) {
    // The real Jev is the default. Without a TypeSafe key (or with JEV_MODE=mock) the local stand-in is used,
    // so the app works either way.
    const mode = opts.mode ?? process.env.JEV_MODE ?? 'gateway';
    this.backend = opts.backend ?? (mode === 'gateway' && typesafeKey() ? new GatewayJev() : new StandinJev());
    this.minIntervalMs = opts.minIntervalMs ?? +(process.env.JEV_MIN_INTERVAL_MS ?? 0);
    this.maxPerMinute = opts.maxPerMinute ?? +(process.env.JEV_MAX_PER_MIN ?? 90);
    this.retries = opts.retries ?? 1;
    const file = opts.logFile === undefined ? 'logs/jev-calls.jsonl' : opts.logFile;
    if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); this.log = fs.createWriteStream(file, { flags: 'a' }); }
  }

  private async throttle() {
    for (;;) {
      const now = Date.now();
      this.window = this.window.filter((t) => now - t < 60_000);
      const waitInterval = this.last + this.minIntervalMs - now;
      const waitBudget = this.window.length >= this.maxPerMinute ? this.window[0] + 60_000 - now : 0;
      const w = Math.max(waitInterval, waitBudget);
      if (w <= 0) break;
      await new Promise((r) => setTimeout(r, w));
    }
    this.last = Date.now();
    this.window.push(this.last);
  }

  async ask(purpose: string, state: JevInput, questions: Record<string, JevQuestion>, image?: Uint8Array): Promise<{ answers: Record<string, JevAnswer>; confidence?: number }> {
    const t0 = Date.now();
    await this.throttle();
    let res;
    for (let attempt = 0; ; attempt++) {
      try { res = await this.backend.evaluate({ state, questions, ...(image ? { image } : {}) }); break; }
      catch (e) { if (attempt >= this.retries) throw e; await new Promise((r) => setTimeout(r, 300)); }
    }
    this.calls++;
    this.inputTokens += res.usage.inputTokens ?? 0;
    const rec: JevCallRecord = {
      n: this.calls, at: Date.now(), purpose, latencyMs: Date.now() - t0, backend: this.backend.name,
      state, sawScreen: !!image, questions, answers: res.answers, inputTokens: res.usage.inputTokens ?? 0,
    };
    this.log?.write(JSON.stringify(rec) + '\n');
    return { answers: res.answers, confidence: res.confidence };
  }
}
