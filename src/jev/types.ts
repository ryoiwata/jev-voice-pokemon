// Mirrors AI SDK `experimental_evaluate` (model 'typesafe-ai/jev') request/response shapes.

export type JevInput = string | Record<string, unknown> | unknown[];

export type JevQuestion =
  | { type: 'choice'; instructions: JevInput; criteria: Record<string, JevInput | null> }
  | { type: 'score'; instructions: JevInput; criteria: (JevInput | null)[] }
  | { type: 'boolean'; instructions: JevInput; criteria?: { true?: JevInput | null; false?: JevInput | null } }
  | { type: 'box'; instructions: JevInput };

export type JevAnswer =
  | { type: 'choice'; choice: string; probabilities?: Record<string, number> }
  | { type: 'score'; score: number; probabilities?: Record<string, number> }
  | { type: 'boolean'; probability: number }
  /** a rectangle on the picture; each edge is a fraction of its width or height from the top-left */
  | { type: 'box'; box: { top: number; bottom: number; left: number; right: number } };

export interface JevRequest {
  state: JevInput;
  questions: Record<string, JevQuestion>;
  /** a PNG of the game screen, when the model should see it */
  image?: Uint8Array;
}

export interface JevResult {
  answers: Record<string, JevAnswer>;
  usage: { inputTokens?: number; outputTokens?: number };
  confidence?: number;
}

export interface JevBackend {
  name: string;
  evaluate(req: JevRequest): Promise<JevResult>;
}
