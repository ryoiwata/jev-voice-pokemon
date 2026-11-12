import { experimental_decide as decide } from 'ai';
import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import type { JevBackend, JevRequest, JevResult } from './types.js';

/** The key for TypeSafe's API. TYPESAFE_API_KEY is this app's name for it; the SDK's own name also works. */
export function typesafeKey(): string {
  return process.env.TYPESAFE_API_KEY || process.env.TYPESAFE_AI_API_KEY || '';
}

interface DecideArgs { modelId: string; state: any; questions: any; abortSignal: AbortSignal }
type DecideResult = { answers: Record<string, any>; usage: { inputTokens?: number; outputTokens?: number }; providerMetadata?: any };

/** The real Jev, called directly at TypeSafe's API with a TypeSafe key. */
export class GatewayJev implements JevBackend {
  name = 'gateway';
  private model: string;
  private decide: (args: DecideArgs) => Promise<DecideResult>;

  constructor(opts: { apiKey?: string; model?: string; decide?: (args: DecideArgs) => Promise<DecideResult> } = {}) {
    this.model = opts.model ?? process.env.JEV_MODEL ?? 'jev-latest';
    if (opts.decide) { this.decide = opts.decide; return; }
    const provider = createTypeSafeAi({ apiKey: opts.apiKey ?? typesafeKey() });
    this.decide = ({ modelId, state, questions, abortSignal }) =>
      decide({ model: provider.decisionModel(modelId), state, questions, abortSignal, maxRetries: 0 }) as Promise<DecideResult>;
  }

  async evaluate(req: JevRequest): Promise<JevResult> {
    const res = await this.decide({
      modelId: this.model,
      // strict JSON only: drops undefined, turns Infinity/NaN into null.
      // With a picture, the state becomes two parts: the facts as JSON, and the game screen as a PNG.
      state: req.image
        ? [{ type: 'json', value: JSON.parse(JSON.stringify(req.state)) }, { type: 'file', mediaType: 'image/png', data: req.image }]
        : JSON.parse(JSON.stringify(req.state)),
      questions: JSON.parse(JSON.stringify(req.questions)),
      // a stuck request must not hold a command up (normal latency is well under a second)
      abortSignal: AbortSignal.timeout(+(process.env.JEV_TIMEOUT_MS ?? 4000)),
    });
    // confidence comes back per question; a command asks exactly one
    const conf = res.providerMetadata?.typesafe?.confidence;
    const confidence = typeof conf === 'number' ? conf : conf && typeof conf === 'object' ? (Object.values(conf)[0] as number | undefined) : undefined;
    return { answers: res.answers as JevResult['answers'], usage: { inputTokens: res.usage?.inputTokens, outputTokens: res.usage?.outputTokens }, confidence };
  }
}
