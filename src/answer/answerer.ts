import Anthropic from '@anthropic-ai/sdk';
import type { GameSnapshot } from '../game/snapshot.js';
import type { AnswererLike } from '../server/session.js';

const SYSTEM = `You answer questions for someone who is playing Pokémon Red (Game Boy, Generation 1 rules) right now, by voice.
You are given their question and the current state of their game.
Answer in plain text, at most four short sentences, with no lists or formatting.
Your answer is read aloud, so write words as they are said (for example "level 12", not "Lv12"). Use their actual party, bag and location when it helps.
Use Generation 1 facts (for example, there are no Dark, Steel or Fairy types, and Special is one stat).
You cannot press buttons or do anything in the game, so never say you did: only answer.`;

const NOT_SET_UP = "Question answering isn't set up. Add ANTHROPIC_API_KEY to .env.";
const FAILED = "Couldn't get an answer just now.";
const DECLINED = "I can't answer that one.";
const TIMEOUT_MS = 20_000;

/** The slice of the Anthropic SDK this uses (so tests can stand in for it). */
export interface StreamClient {
  stream(params: Record<string, any>, options: { timeout: number }): AsyncIterable<any> & { finalMessage(): Promise<{ stop_reason: string | null }> };
}

/** The game state as a few plain lines for the model. */
export function gameContext(s: GameSnapshot): string {
  const party = s.party.length
    ? s.party.map((p) => `${p.nickname} (${p.species} Lv${p.level}, ${p.types.join('/')}, HP ${p.hp}/${p.maxHp}${p.status !== 'OK' ? `, ${p.status}` : ''}; moves: ${p.moves.map((m) => `${m.name} ${m.pp}/${m.maxPp}`).join(', ')})`).join('; ')
    : 'no Pokémon yet';
  const lines = [
    `Location: ${s.map || 'not started'}`,
    `Party: ${party}`,
    `Bag: ${s.bag.length ? s.bag.map((i) => `${i.name} x${i.qty}`).join(', ') : 'empty'}`,
    `Money: ${s.money}. ${s.badges} badges. Pokédex: ${s.pokedex.seen} seen, ${s.pokedex.owned} owned.`,
  ];
  if (s.battle) lines.push(`In a ${s.battle.kind} battle against ${s.battle.enemy.species} Lv${s.battle.enemy.level} (HP ${s.battle.enemy.hp}/${s.battle.enemy.maxHp}${s.battle.enemy.status !== 'OK' ? `, ${s.battle.enemy.status}` : ''}).`);
  if (s.dialog.trim()) lines.push(`Text on screen: "${s.dialog.replace(/▼/g, '').trim()}"`);
  return lines.join('\n');
}

/** Answers the player's questions with Claude. It only ever produces text. */
export class Answerer implements AnswererLike {
  readonly enabled: boolean;
  private client: StreamClient | null;
  private model: string;

  constructor(opts: { apiKey?: string; model?: string; client?: StreamClient } = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
    this.enabled = !!apiKey;
    this.model = opts.model ?? process.env.ANSWER_MODEL ?? 'claude-sonnet-5-5';
    this.client = !this.enabled ? null : opts.client ?? (new Anthropic({ apiKey, maxRetries: 1 }).messages as unknown as StreamClient);
  }

  async answer(question: string, state: GameSnapshot, onDelta?: (soFar: string) => void): Promise<string> {
    if (!this.client) return NOT_SET_UP;
    try {
      const stream = this.client.stream({
        model: this.model,
        // room for the model's thinking as well as a short answer
        max_tokens: 2000,
        output_config: { effort: 'low' },
        system: SYSTEM,
        messages: [{ role: 'user', content: `Game state:\n${gameContext(state)}\n\nQuestion: ${question.slice(0, 500)}` }],
      }, { timeout: TIMEOUT_MS });
      let text = '';
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') { text += event.delta.text; onDelta?.(text); }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') return DECLINED;
      return text.trim() || FAILED;
    } catch (e) {
      console.error(`[answer] ${(e as Error).message}`);
      return FAILED;
    }
  }
}
