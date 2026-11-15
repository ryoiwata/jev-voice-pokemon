// The request and answer shapes of TypeSafe's System One API (POST /v1/systemone), as this app uses them.

export type JevInput = string | Record<string, unknown> | unknown[];

export type JevQuestion =
  | { type: 'choice'; instructions: JevInput; criteria: Record<string, JevInput | null> }
  | { type: 'score'; instructions: JevInput; criteria: (JevInput | null)[] }
  | { type: 'noul'; instructions: JevInput; criteria?: { true?: JevInput | null; false?: JevInput | null } }
  | { type: 'box'; instructions: JevInput };

export type JevAnswer =
  | { type: 'choice'; choice: string; probabilities?: Record<string, number>; confidence?: number }
  | { type: 'score'; score: number; probabilities?: Record<string, number>; confidence?: number }
  /** the probability that the statement is true */
  | { type: 'noul'; noul: number }
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
  /** the versioned model that answered (an alias such as jev-latest resolves to one) */
  model?: string;
}

export interface JevBackend {
  name: string;
  evaluate(req: JevRequest): Promise<JevResult>;
}
