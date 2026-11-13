import type { Action } from '../actions/types.js';
import type { GameSnapshot } from '../game/snapshot.js';
import type { Jev } from '../jev/client.js';
import type { JevBackend, JevAnswer, JevQuestion } from '../jev/types.js';

export interface Thresholds { minP: number; minMargin: number; costlyMinP: number; costlyMinMargin: number; timeoutMs: number }

export type Interpretation =
  | { kind: 'act'; action: Action; p: number }
  | { kind: 'question' }
  | { kind: 'impossible' }
  | { kind: 'clarify'; options: Action[] }
  /** asked whether a command needs anything more: it does not (or the model was not sure enough to say what) */
  | { kind: 'done' }
  | { kind: 'nothing'; reason: 'empty' | 'busy' | 'long' };
export type Interpreted = Interpretation & { backend: string; fellBack: boolean };

const env = (name: string, d: number) => { const v = Number(process.env[name]); return Number.isFinite(v) && process.env[name] !== undefined && process.env[name] !== '' ? v : d; };
const MAX_SAID = 200;
/** Jev takes at most 255 options; two are ours. */
const MAX_CANDIDATES = 253;
const INSTRUCTIONS = 'A person is playing Pokémon Red by voice. "said" is what they just said (speech-to-text, so names may be misspelled). '
  + 'Each option is one thing that can be done in the game right now. Choose the option the player asked for. '
  + 'Do not choose what would be a good move in the game: choose only what the player asked for.';

/** Said to the model when a command is being carried out one action at a time. */
const STEPWISE = 'This command may need several actions, one after another. alreadyDone lists the actions carried out so far, in order (it may be empty). '
  + 'Choose the single action that comes NEXT in what the player said. If nothing more is needed, choose __done.';

/** Raw button presses are for the fixed grammar; they are never offered as guesses. Steps in a direction are. */
const guessable = (a: Action) => a.kind !== 'press';

/** The game's numbers, in a compact form the model can read at a glance. */
function facts(state: GameSnapshot) {
  return {
    situation: state.mode, place: state.map, player: { x: state.x, y: state.y, facing: state.facing },
    onScreenText: state.dialog,
    party: state.party.map((p) => ({
      name: p.nickname, species: p.species, level: p.level, hp: `${p.hp}/${p.maxHp}`, ...(p.status !== 'OK' ? { status: p.status } : {}),
      moves: p.moves.map((m) => `${m.name} ${m.pp}/${m.maxPp}`),
    })),
    ...(state.around ? { nextToPlayer: state.around } : {}),
    bag: state.bag.map((i) => `${i.name} x${i.qty}`), money: state.money, badges: state.badges,
    ...(state.battle ? { battle: { kind: state.battle.kind, enemy: `${state.battle.enemy.species} Lv${state.battle.enemy.level}`, enemyHp: `${state.battle.enemy.hp}/${state.battle.enemy.maxHp}` } } : {}),
  };
}

/**
 * Works out which of the currently possible actions a typed or dictated command means.
 * Jev (or the local stand-in) picks from the list; thresholds decide whether to act or ask.
 */
export class Interpreter {
  private th: Thresholds;

  constructor(private jev: Jev, private fallback: JevBackend, th: Partial<Thresholds> = {}) {
    this.th = {
      minP: th.minP ?? env('ACT_MIN_P', 0.6), minMargin: th.minMargin ?? env('ACT_MIN_MARGIN', 0.2),
      costlyMinP: th.costlyMinP ?? env('COSTLY_MIN_P', 0.85), costlyMinMargin: th.costlyMinMargin ?? env('COSTLY_MIN_MARGIN', 0.4),
      timeoutMs: th.timeoutMs ?? env('JEV_TIMEOUT_MS', 4000),
    };
  }

  /** `strict` holds every option to the costly thresholds (used for an automatic follow-up). */
  /** `image`: a PNG of the game screen, so the model sees what the player sees. */
  /**
   * `progress`: what has already been carried out for this same command. The model is then asked what, if
   * anything, comes next, and may answer that everything is done. Only a strong match counts as a next
   * step; anything else means done. The local word-matcher never carries on.
   */
  async interpret(said: string, actions: Action[], state: GameSnapshot, opts: { strict?: boolean; justDid?: string; image?: Uint8Array; progress?: string[] } = {}): Promise<Interpreted> {
    const backend = this.jev.backend.name;
    const text = said.trim();
    if (!text) return { kind: 'nothing', reason: 'empty', backend, fellBack: false };
    // a paragraph is not a command; acting on its first words would be a guess
    if (text.length > MAX_SAID) return { kind: 'nothing', reason: 'long', backend, fellBack: false };
    let cands = actions.filter(guessable);
    if (!cands.length) return { kind: 'nothing', reason: 'busy', backend, fellBack: false };
    if (cands.length > MAX_CANDIDATES) cands = [...cands].sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0)).slice(0, MAX_CANDIDATES);

    // The real model reads a fuller description of each option; the word-matcher compares against the plain label.
    const describe = (full: boolean) => {
      const c: Record<string, string> = {};
      for (const a of cands) c[a.id] = full ? a.hint ?? a.label : a.label;
      c.__question = 'The player is asking a question, not giving a command';
      c.__impossible = 'The player wants something that none of the other options does';
      if (opts.progress) c.__done = 'Everything the player asked for has now been done (see alreadyDone): nothing more is needed. Choose this unless the command clearly asks for a further step that has not been done yet';
      return c;
    };
    const real = backend === 'gateway';
    if (opts.progress && !real) return { kind: 'done', backend, fellBack: false };
    const criteria = describe(real);
    const questions: Record<string, JevQuestion> = { intent: { type: 'choice', instructions: INSTRUCTIONS, criteria } };
    // justDid: the part of this same sentence that has already been carried out ("Use POTION" in "use potion on pikachu")
    const jevState = { said: text, ...(opts.justDid ? { justDid: opts.justDid } : {}), ...(opts.progress ? { alreadyDone: opts.progress, howToChoose: STEPWISE } : {}), ...facts(state) };

    let answer: JevAnswer | undefined, used = backend, fellBack = false;
    try {
      const res = await Promise.race([
        this.jev.ask('command', jevState, questions, opts.image),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Jev timed out')), this.th.timeoutMs)),
      ]);
      answer = res.answers.intent;
    } catch {
      // Jev is down or slow: this one command goes to the local matcher instead
      const plain: Record<string, JevQuestion> = { intent: { type: 'choice', instructions: INSTRUCTIONS, criteria: describe(false) } };
      answer = (await this.fallback.evaluate({ state: jevState, questions: plain })).answers.intent;
      used = this.fallback.name; fellBack = true;
      if (opts.progress) return { kind: 'done', backend: used, fellBack };
    }
    const decided = this.decide(answer, cands, !!opts.strict || !!opts.progress);
    if (opts.progress && decided.kind !== 'act') return { kind: 'done', backend: used, fellBack };
    return { ...decided, backend: used, fellBack };
  }

  private decide(answer: JevAnswer | undefined, cands: Action[], strict: boolean): Interpretation {
    if (!answer || answer.type !== 'choice') return { kind: 'impossible' };
    if (!answer.probabilities) {
      // no measure of how sure the model is: never act unasked on that
      const only = new Map(cands.map((a) => [a.id, a])).get(answer.choice);
      if (answer.choice === '__question') return { kind: 'question' };
      return only ? { kind: 'clarify', options: [only] } : { kind: 'impossible' };
    }
    const probs = answer.probabilities;
    const ranked = Object.entries(probs).sort((a, b) => b[1] - a[1]);
    const [top, p] = ranked[0] ?? [answer.choice, 1];
    const p2 = ranked[1]?.[1] ?? 0;
    if (top === '__question') return { kind: 'question' };
    if (top === '__impossible') return { kind: 'impossible' };
    const byId = new Map(cands.map((a) => [a.id, a]));
    const action = byId.get(top);
    if (!action) return { kind: 'impossible' };
    const costly = strict || !!action.costly;
    const minP = costly ? this.th.costlyMinP : this.th.minP, minMargin = costly ? this.th.costlyMinMargin : this.th.minMargin;
    if (p >= minP && p - p2 >= minMargin) return { kind: 'act', action, p };
    const options = ranked.filter(([id, pr]) => byId.has(id) && pr > 0).slice(0, 3).map(([id]) => byId.get(id)!);
    return { kind: 'clarify', options };
  }
}
