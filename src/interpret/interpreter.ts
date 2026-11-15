import type { Action } from '../actions/types.js';
import type { GameSnapshot } from '../game/snapshot.js';
import type { Jev } from '../jev/client.js';
import type { JevBackend, JevAnswer, JevQuestion } from '../jev/types.js';
import { ACT, NO, QID, YES, commandQuestions, nameQuestions, type IntentMode } from './questions.js';
import { nameCandidates, nameWords } from './name.js';

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

/** What a naming screen should type: a name, nothing yet (none was said, or it is unclear), or a question to answer. */
export type NameReading = { kind: 'name'; text: string } | { kind: 'none' } | { kind: 'question' };
export type NameRead = NameReading & { backend: string; fellBack: boolean };

const env = (name: string, d: number) => { const v = Number(process.env[name]); return Number.isFinite(v) && process.env[name] !== undefined && process.env[name] !== '' ? v : d; };
const MAX_SAID = 200;
/** A Choice question takes at most 255 options. */
const MAX_CANDIDATES = 255;

/** Raw button presses are for the fixed grammar; they are never offered as guesses. Steps in a direction are. */
const guessable = (a: Action) => a.kind !== 'press';

/**
 * The game facts a command can depend on, and no more: unrelated detail costs the model accuracy.
 * On the map that is where the player is and what is around them; in a battle, the battle, the party and the bag;
 * on menus and text, the party and the bag (menus list them). Money and badges never decide a command.
 */
export function facts(state: GameSnapshot) {
  const text = state.dialog ? { onScreenText: state.dialog } : {};
  const fullParty = () => state.party.map((p) => ({
    name: p.nickname, species: p.species, level: p.level, hp: `${p.hp}/${p.maxHp}`, ...(p.status !== 'OK' ? { status: p.status } : {}),
    moves: p.moves.map((m) => `${m.name} ${m.pp}/${m.maxPp}`),
  }));
  const bag = () => state.bag.map((i) => `${i.name} x${i.qty}`);
  // what the player and the rival are called, so "my rival's house" and the rival's own name can be matched
  const names = state.playerName || state.rivalName ? { names: { player: state.playerName, rival: state.rivalName ?? '' } } : {};
  const base = { situation: state.mode, place: state.map, ...names, ...text };
  if (state.mode === 'overworld') {
    return {
      ...base, player: { x: state.x, y: state.y, facing: state.facing },
      ...(state.around ? { nextToPlayer: state.around } : {}),
      party: state.party.map((p) => ({ name: p.nickname, species: p.species })),
    };
  }
  if (state.battle) {
    const e = state.battle.enemy;
    return { ...base, battle: { kind: state.battle.kind, enemy: `${e.species} level ${e.level}`, enemyHp: `${e.hp}/${e.maxHp}` }, party: fullParty(), bag: bag() };
  }
  return { ...base, party: fullParty().map(({ moves: _m, ...p }) => p), bag: bag() };
}

const noul = (a: JevAnswer | undefined): number | undefined => (a?.type === 'noul' ? a.noul : undefined);

/**
 * Works out which of the currently possible actions a typed or dictated command means.
 * Jev (or the local stand-in) answers the questions in questions.ts; the rules below turn the answers into
 * acting, asking which was meant, answering a question, or saying it cannot be done here.
 */
export class Interpreter {
  private th: Thresholds;

  constructor(private jev: Jev, private fallback: JevBackend, th: Partial<Thresholds> = {}) {
    this.th = {
      minP: th.minP ?? env('ACT_MIN_P', ACT.minP), minMargin: th.minMargin ?? env('ACT_MIN_MARGIN', ACT.minMargin),
      costlyMinP: th.costlyMinP ?? env('COSTLY_MIN_P', ACT.costlyMinP), costlyMinMargin: th.costlyMinMargin ?? env('COSTLY_MIN_MARGIN', ACT.costlyMinMargin),
      timeoutMs: th.timeoutMs ?? env('JEV_TIMEOUT_MS', 4000),
    };
  }

  /** Ask the real model, or on failure or timeout the stand-in, with the same state. */
  private async ask(purpose: string, state: Record<string, unknown>, real: Record<string, JevQuestion>, plain: Record<string, JevQuestion>, image?: Uint8Array) {
    const backend = this.jev.backend.name;
    try {
      const res = await Promise.race([
        this.jev.ask(purpose, state, real, image),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Jev timed out')), this.th.timeoutMs)),
      ]);
      return { answers: res.answers, backend, fellBack: false };
    } catch (e) {
      // Jev is down or slow: this one call goes to the local matcher instead, and the server log says why
      console.warn(`Jev failed (${e instanceof Error ? e.message : String(e)}); the local matcher answered "${String(state.said)}".`);
      const res = await this.fallback.evaluate({ state, questions: plain });
      return { answers: res.answers, backend: this.fallback.name, fellBack: true };
    }
  }

  /**
   * `strict` holds every option to the costly thresholds (used for an automatic follow-up after a game prompt).
   * `justDid`: the part of this same sentence already carried out ("Use POTION" in "use potion on pikachu").
   * `image`: a PNG of the game screen, so the model sees what the player sees.
   * `progress`: what has already been carried out for this same command. The model is then asked whether
   * everything is done and, if not, what comes next. Only a clear "not yet" with a strong pick counts as a next
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
    const real = backend === 'gateway';
    if (opts.progress && !real) return { kind: 'done', backend, fellBack: false };

    // The real model reads a fuller description of each option; the word-matcher compares against the plain label.
    const describe = (full: boolean) => Object.fromEntries(cands.map((a) => [a.id, full ? a.hint ?? a.label : a.label]));
    const mode: IntentMode = opts.progress ? 'next' : opts.justDid ? 'followUp' : 'first';
    const options = describe(real);
    const jevState = {
      said: text, ...(opts.justDid ? { justDid: opts.justDid } : {}), ...(opts.progress ? { alreadyDone: opts.progress } : {}),
      canDoNow: Object.values(options), ...facts(state),
    };
    const res = await this.ask('command', jevState, commandQuestions(options, mode), commandQuestions(describe(false), mode), opts.image);
    if (opts.progress && res.fellBack) return { kind: 'done', backend: res.backend, fellBack: true };
    const decided = this.decide(res.answers, cands, mode, !!opts.strict);
    return { ...decided, backend: res.backend, fellBack: res.fellBack };
  }

  /**
   * The truth table. `asking` and `fits` are yes/no answers; YES and NO are the thresholds.
   *   asking ≥ YES                               → answer the question
   *   fits ≤ NO                                  → a question if asking is above NO, else cannot be done here
   *   fits ≥ YES and the pick is likely enough   → act
   *   fits unsettled and the pick is very sure   → act (the costly thresholds)
   *   anything else                              → ask which was meant (top three)
   * For a further step: act only on done ≤ NO, fits ≥ YES and a strict pick; otherwise the command is done.
   * A yes/no answer that is missing counts as unsettled, never as a yes.
   */
  private decide(answers: Record<string, JevAnswer>, cands: Action[], mode: IntentMode, strict: boolean): Interpretation {
    const answer = answers[QID.intent];
    const asking = noul(answers[QID.asking]) ?? 0;
    const fitsAnswer = noul(answers[QID.fits]);
    const fits = fitsAnswer ?? 0.5;
    const byId = new Map(cands.map((a) => [a.id, a]));
    if (mode === 'next') {
      const done = noul(answers[QID.done]) ?? 1;
      if (done > NO || fits < YES) return { kind: 'done' };
      const pick = this.pick(answer, byId, true);
      return pick.kind === 'act' ? pick : { kind: 'done' };
    }
    if (mode === 'first' && asking >= YES) return { kind: 'question' };
    if (fits <= NO) return mode === 'first' && asking > NO ? { kind: 'question' } : { kind: 'impossible' };
    if (fitsAnswer === undefined) return this.clarify(answer, byId);
    // an unsettled fit is not a no: in trials it was unsure about commands that could be done far more often than
    // about ones that could not, so a very sure pick still acts; anything less asks
    return this.pick(answer, byId, strict || fits < YES);
  }

  /** Act on the picked action when it is likely enough and clear of the runner-up; otherwise ask. */
  private pick(answer: JevAnswer | undefined, byId: Map<string, Action>, strict: boolean): Interpretation {
    if (!answer || answer.type !== 'choice') return { kind: 'impossible' };
    // no measure of how sure the model is: never act unasked on that
    if (!answer.probabilities) return this.clarify(answer, byId);
    const ranked = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
    const [top, p] = ranked[0] ?? [answer.choice, 0];
    const p2 = ranked[1]?.[1] ?? 0;
    const action = byId.get(top);
    if (!action) return { kind: 'impossible' };
    const costly = strict || !!action.costly;
    const minP = costly ? this.th.costlyMinP : this.th.minP, minMargin = costly ? this.th.costlyMinMargin : this.th.minMargin;
    if (p >= minP && p - p2 >= minMargin) return { kind: 'act', action, p };
    return this.clarify(answer, byId);
  }

  private clarify(answer: JevAnswer | undefined, byId: Map<string, Action>): Interpretation {
    if (!answer || answer.type !== 'choice') return { kind: 'impossible' };
    const ranked = answer.probabilities ? Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]) : [[answer.choice, 1] as [string, number]];
    const options = ranked.filter(([id, pr]) => byId.has(id) && pr > 0).slice(0, 3).map(([id]) => byId.get(id)!);
    return options.length ? { kind: 'clarify', options } : { kind: 'impossible' };
  }

  /**
   * On a naming screen: which of the words said is the name. Code finds the candidate words; Jev picks one and
   * says whether a name was said at all. The stand-in uses the words left after dropping filler.
   * `exclude`: words that belong to something already done in this sentence (the "NEW NAME" of "new name Shigeru").
   */
  async readName(said: string, state: GameSnapshot, image?: Uint8Array, exclude: string[] = []): Promise<NameRead> {
    const backend = this.jev.backend.name;
    const text = said.trim();
    const skip = new Set(exclude.map((w) => w.toLowerCase()));
    const keep = (w: string) => !skip.has(w.toLowerCase());
    const plainWords = nameWords(text).filter(keep);
    const local = (b: string, fellBack: boolean): NameRead => (plainWords.length ? { kind: 'name', text: plainWords.join(''), backend: b, fellBack } : { kind: 'none', backend: b, fellBack });
    if (backend !== 'gateway') return local(backend, false);
    const words = nameCandidates(text).filter(keep);
    if (!words.length) return { kind: 'none', backend, fellBack: false };
    const questions = nameQuestions(words);
    const jevState = { said: text, ...facts(state) };
    let answers: Record<string, JevAnswer>;
    try {
      answers = (await Promise.race([
        this.jev.ask('name', jevState, questions, image),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Jev timed out')), this.th.timeoutMs)),
      ])).answers;
    } catch (e) {
      console.warn(`Jev failed (${e instanceof Error ? e.message : String(e)}); the local matcher read the name in "${text}".`);
      return local(this.fallback.name, true);
    }
    const asking = noul(answers[QID.asking]) ?? 0;
    const says = noul(answers[QID.saysName]) ?? 0.5;
    if (asking >= YES) return { kind: 'question', backend, fellBack: false };
    const pick = answers[QID.name];
    if (says < YES || pick?.type !== 'choice' || !words.includes(pick.choice)) return { kind: 'none', backend, fellBack: false };
    const p = pick.probabilities?.[pick.choice] ?? 0;
    return p >= this.th.minP ? { kind: 'name', text: pick.choice, backend, fellBack: false } : { kind: 'none', backend, fellBack: false };
  }
}
