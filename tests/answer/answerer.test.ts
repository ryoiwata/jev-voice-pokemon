import { describe, it, expect } from 'vitest';
import { Answerer, gameContext, type StreamClient } from '../../src/answer/answerer.js';
import type { GameSnapshot } from '../../src/game/snapshot.js';

const S: GameSnapshot = {
  mode: 'battle', map: 'VIRIDIAN_CITY', x: 1, y: 1, facing: 'down', money: 3120, badges: 2, pokedex: { seen: 11, owned: 4 }, playTime: '3:42',
  party: [{ slot: 0, speciesId: 1, species: 'SQUIRTLE', nickname: 'SQUIRT', level: 12, hp: 28, maxHp: 35, status: 'OK', types: ['WATER'],
    moves: [{ id: 1, name: 'WATER GUN', type: 'WATER', power: 40, accuracy: 100, pp: 25, maxPp: 25 }] }],
  bag: [{ name: 'POTION', qty: 2 }], battle: { kind: 'wild', enemy: { species: 'GEODUDE', level: 9, hp: 20, maxHp: 24, status: 'OK' } },
  dialog: 'Wild GEODUDE appeared!', running: null,
};

/** A client that streams the given pieces of text, then ends with `stop`. */
function streaming(pieces: string[], stop = 'end_turn'): StreamClient & { seen: any[] } {
  const seen: any[] = [];
  return {
    seen,
    stream(params, options) {
      seen.push({ params, options });
      return {
        async *[Symbol.asyncIterator]() { for (const text of pieces) yield { type: 'content_block_delta', delta: { type: 'text_delta', text } }; },
        finalMessage: async () => ({ stop_reason: stop }),
      };
    },
  };
}
const throwing: StreamClient = { stream() { throw new Error('529 overloaded'); } };
const failingMidway: StreamClient = {
  stream: () => ({
    async *[Symbol.asyncIterator]() { yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Wa' } }; throw new Error('connection reset'); },
    finalMessage: async () => ({ stop_reason: 'end_turn' }),
  }),
};

describe('gameContext', () => {
  it('describes where the player is, their party, bag and the battle', () => {
    const c = gameContext(S);
    for (const part of ['VIRIDIAN_CITY', 'SQUIRT', 'SQUIRTLE', 'Lv12', '28/35', 'WATER GUN', 'POTION', 'GEODUDE', '2 badges', '3120']) expect(c).toContain(part);
  });
  it('says so when there is no party yet', () => {
    expect(gameContext({ ...S, party: [], battle: null })).toContain('no Pokémon yet');
  });
});

describe('Answerer', () => {
  it('is off without a key and says how to turn it on', async () => {
    const a = new Answerer({ apiKey: '' });
    expect(a.enabled).toBe(false);
    expect(await a.answer('hi?', S)).toBe("Question answering isn't set up. Add ANTHROPIC_API_KEY to .env.");
  });
  it('streams the answer as it grows and returns the whole of it', async () => {
    const deltas: string[] = [];
    const a = new Answerer({ apiKey: 'k', client: streaming(['Wa', 'ter']) });
    expect(await a.answer('q?', S, (d) => deltas.push(d))).toBe('Water');
    expect(deltas).toEqual(['Wa', 'Water']);
  });
  it('sends the question, the game state, the chosen model and a time limit', async () => {
    const client = streaming(['ok']);
    await new Answerer({ apiKey: 'k', client, model: 'claude-haiku-5-5' }).answer('what beats rock?', S);
    const { params, options } = client.seen[0];
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.messages[0].content).toContain('what beats rock?');
    expect(params.messages[0].content).toContain('GEODUDE');
    expect(params.system).toMatch(/Pokémon Red/);
    expect(options.timeout).toBe(20_000);
  });
  it('defaults to claude-sonnet-5-5', async () => {
    const client = streaming(['ok']);
    await new Answerer({ apiKey: 'k', client }).answer('q?', S);
    expect(client.seen[0].params.model).toBe('claude-sonnet-5-5');
  });
  it('never rejects: an API error becomes one plain line', async () => {
    expect(await new Answerer({ apiKey: 'k', client: throwing }).answer('hi?', S)).toBe("Couldn't get an answer just now.");
    expect(await new Answerer({ apiKey: 'k', client: failingMidway }).answer('hi?', S)).toBe("Couldn't get an answer just now.");
  });
  it('says so when the model declines or returns nothing', async () => {
    expect(await new Answerer({ apiKey: 'k', client: streaming([], 'refusal') }).answer('hi?', S)).toBe("I can't answer that one.");
    expect(await new Answerer({ apiKey: 'k', client: streaming([]) }).answer('hi?', S)).toBe("Couldn't get an answer just now.");
  });
});
