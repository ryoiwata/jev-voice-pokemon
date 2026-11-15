// Every question this app asks Jev, and every threshold its answers are read against, in one place.
// Jev makes the judgments; src/interpret/interpreter.ts turns them into what the app does.
import type { JevQuestion } from '../jev/types.js';

/** Question ids. The model never sees these; code reads the answers by them. */
export const QID = {
  /** Choice: which of the actions on offer the player asked for */
  intent: 'intent',
  /** Noul: is the player asking a question rather than giving a command */
  asking: 'asking',
  /** Noul: does any action on offer do what the player asked */
  fits: 'fits',
  /** Noul (a command carried out step by step): has everything asked for been done */
  done: 'done',
  /** Choice (a naming screen): which of the candidate words is the name */
  name: 'name',
  /** Noul (a naming screen): did the player say a name at all */
  saysName: 'saysName',
} as const;

/** A Noul above YES reads as yes, below NO as no; between them the question is not settled. */
export const YES = 0.7;
export const NO = 0.3;

/**
 * How likely the picked action must be, and how far ahead of the next one, before it runs without asking.
 * Costly actions (hard to undo), follow-ups and further steps of one command use the stricter pair.
 */
export const ACT = { minP: 0.6, minMargin: 0.2, costlyMinP: 0.85, costlyMinMargin: 0.4 };

const SAID = '`said` is what the player just said (speech-to-text, so names may be misspelled).';

/** How the action question is put: a fresh command, the rest of a command after a game prompt, or the next step of one. */
export type IntentMode = 'first' | 'followUp' | 'next';

const INTENT: Record<IntentMode, string> = {
  first: `A person is playing Pokémon Red by voice. ${SAID} Which of these actions did the player ask for? `
    + 'Choose what the player asked for, not what would be a good move in the game.',
  followUp: `A person is playing Pokémon Red by voice. ${SAID} The first part of their command, \`justDid\`, has been done, and the game now asks for more. `
    + 'Which of these actions does the rest of what they said ask for?',
  next: `A person is playing Pokémon Red by voice. ${SAID} Their command is being carried out one action at a time; \`alreadyDone\` lists the actions done so far, in order. `
    + 'Which of these actions does the command ask for next?',
};

/** The questions sent with a command. `options` maps each action id to its description. */
export function commandQuestions(options: Record<string, string>, mode: IntentMode): Record<string, JevQuestion> {
  const qs: Record<string, JevQuestion> = {
    [QID.intent]: { type: 'choice', instructions: INTENT[mode], criteria: options },
    [QID.fits]: {
      type: 'noul',
      instructions: 'Does one of the actions in `canDoNow` do what the player asked for in `said`?',
      criteria: {
        true: 'One action in `canDoNow` does what the player asked for, even if the player used other words for it, such as "the man" for a person the game calls a Fisher.',
        false: 'No action in `canDoNow` does it, such as when the player asks to fly to a town and no listed action flies there.',
      },
    },
  };
  if (mode === 'first') {
    qs[QID.asking] = {
      type: 'noul',
      instructions: 'Is the player asking a question in `said`, rather than telling the game what to do?',
      criteria: {
        true: 'The player wants to know something, such as "what is Onix weak to?" or "where do I go next?".',
        false: 'The player tells the game to do something, such as "talk to the girl" or "use a potion", including a command put politely as a question, such as "can you open the menu?".',
      },
    };
  }
  if (mode === 'next') {
    qs[QID.done] = {
      type: 'noul',
      instructions: 'Has everything the player asked for in `said` been done, going by `alreadyDone`?',
      criteria: {
        true: 'The actions in `alreadyDone` cover every part of `said`, such as having gone around the boy when the player said "go around the boy".',
        false: '`said` asks for something that `alreadyDone` does not cover yet, such as talking to a person the player has only walked up to.',
      },
    };
  }
  return qs;
}

/** The questions sent on a naming screen. `words` are the candidates code found in what was said. */
export function nameQuestions(words: string[]): Record<string, JevQuestion> {
  return {
    [QID.name]: {
      type: 'choice',
      instructions: `The game asks the player for a name. ${SAID} Which of these is the name the player wants typed?`,
      criteria: Object.fromEntries(words.map((w) => [w, `The name "${w}"`])),
    },
    [QID.saysName]: {
      type: 'noul',
      instructions: 'Does the player say in `said` the name they want typed?',
      criteria: {
        true: '`said` contains the name itself, such as "call him Leo" or "my name is Ash".',
        false: '`said` asks for a name without saying one, such as "type a name" or "give it a nickname".',
      },
    },
    [QID.asking]: {
      type: 'noul',
      instructions: 'Is the player asking a question in `said`, rather than telling the game what to do?',
      criteria: {
        true: 'The player wants to know something, such as "what is a good name for a Squirtle?".',
        false: 'The player tells the game what to do, such as "name him Leo".',
      },
    },
  };
}
