import { TypeSafeClient, image } from '@typesafe-ai/sdk';
import type { JevBackend, JevRequest, JevResult, JevAnswer } from './types.js';

/**
 * The Jev version this app is tuned for. The thresholds in src/interpret/questions.ts were checked against it;
 * an alias such as jev-latest moves with each release, so it is only used when JEV_MODEL asks for it.
 */
export const JEV_MODEL = 'jev-1.14.0';

/** Images are an early feature at TypeSafe: each request that carries one has to say so. */
const IMAGES_HEADER = { 'TypeSafe-Danger-Zone-Images': 'true' };

/** The key for TypeSafe's API. TYPESAFE_API_KEY is the SDK's own name; TYPESAFE_AI_API_KEY also works. */
export function typesafeKey(): string {
  return process.env.TYPESAFE_API_KEY || process.env.TYPESAFE_AI_API_KEY || '';
}

/** The one SDK method used, so tests can stand in for it. */
export interface SystemOneClient {
  systemOne(request: { state: any; questions: any; model?: string }, options?: { timeout?: number; headers?: Record<string, string> }): PromiseLike<any>;
}

/** The real Jev, called at TypeSafe's API through the official SDK. */
export class GatewayJev implements JevBackend {
  name = 'gateway';
  private model: string;
  private client: SystemOneClient;

  constructor(opts: { apiKey?: string; model?: string; client?: SystemOneClient } = {}) {
    this.model = opts.model ?? (process.env.JEV_MODEL || JEV_MODEL);
    // A command waits on this call, so a rate limit is retried briefly and a long Retry-After is not waited out:
    // the interpreter falls back to the stand-in instead.
    this.client = opts.client ?? new TypeSafeClient({
      apiKey: opts.apiKey ?? typesafeKey(), logLevel: 'off',
      retry: { maxRetries: 1, backoffInitialMs: 150, backoffMaxMs: 500, maxRetryAfterMs: 1000 },
    });
  }

  async evaluate(req: JevRequest): Promise<JevResult> {
    // strict JSON only: drops undefined, turns Infinity/NaN into null
    const facts = JSON.parse(JSON.stringify(req.state));
    // the game screen goes into the state beside the facts, so a question can refer to it as `screen`
    const state = req.image ? { ...facts, screen: image(req.image) } : facts;
    const res = await this.client.systemOne(
      { state, questions: JSON.parse(JSON.stringify(req.questions)), model: this.model },
      // a stuck request must not hold a command up (normal latency is well under a second)
      { timeout: +(process.env.JEV_TIMEOUT_MS ?? 4000), ...(req.image ? { headers: IMAGES_HEADER } : {}) },
    );
    return {
      answers: res.answers as Record<string, JevAnswer>,
      usage: { inputTokens: res.usage?.input_tokens ?? undefined, outputTokens: res.usage?.output_tokens ?? undefined },
      model: res.model,
    };
  }
}
