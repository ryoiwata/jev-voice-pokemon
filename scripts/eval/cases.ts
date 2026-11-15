// Labelled commands for the live Jev evaluation (scripts/eval/run.ts), each against a saved game state.
//   act:        the command means one of these actions; acting on one is right, asking among options that include one is safe
//   clarify:    the command fits several of these equally; asking is right, acting on one of them is safe
//   impossible: nothing on offer does it; saying so is right, asking is safe
//   question:   the player wants an answer, not an action
export type Expect = { act: string[] } | { clarify: string[] } | { kind: 'impossible' } | { kind: 'question' };
export interface Case { state: string; said: string; expect: Expect }

const act = (...ids: string[]): Expect => ({ act: ids });
const clarify = (...ids: string[]): Expect => ({ clarify: ids });
const impossible: Expect = { kind: 'impossible' };
const question: Expect = { kind: 'question' };

const P = 'fixtures/fx-pallet', B = 'fixtures/fx-bedroom', L = 'fixtures/fx-lab', T = 'fixtures/fx-battle', W = 'fixtures/fx-wild', F = 'fixtures/fx-forest', D = 'fixtures/fx-dialog', M = 'fixtures/fx-menu';

export const CASES: Case[] = [
  // Pallet Town: a girl, a fisher, four signs, three buildings, two exits
  { state: P, said: 'talk to the girl', expect: act('npc:2@0') },
  { state: P, said: 'Talk to the man.', expect: act('npc:3@0') },
  { state: P, said: 'talk to the fisherman', expect: act('npc:3@0') },
  { state: P, said: 'Talk to a person.', expect: clarify('npc:2@0', 'npc:3@0') },
  { state: P, said: 'go home', expect: act('warp:5,5@0') },
  { state: P, said: 'Enter the lab.', expect: act('warp:12,11@0') },
  { state: P, said: "go to professor oak's lab", expect: act('warp:12,11@0') },
  { state: P, said: "visit my rival's house", expect: act('warp:13,5@0') },
  { state: P, said: 'head north to route 1', expect: act('exit:up') },
  { state: P, said: 'Read the sign.', expect: clarify('sign:3,5@0', 'sign:7,9@0', 'sign:11,5@0', 'sign:13,13@0') },
  { state: P, said: 'save game', expect: act('startmenu:SAVE') },
  { state: P, said: 'open my bag', expect: act('startmenu:ITEM') },
  { state: P, said: 'walk around the girl', expect: act('terrain:past:2,7@0') },
  { state: P, said: 'fly to viridian city', expect: impossible },
  { state: P, said: 'use surf', expect: impossible },
  { state: P, said: 'talk to mom', expect: impossible },
  { state: P, said: 'who lives in the house next door?', expect: question },
  { state: P, said: 'where should I go first', expect: question },
  { state: P, said: 'can you open the menu?', expect: act('start') },
  { state: P, said: 'Taco', expect: impossible },

  // Red's bedroom
  { state: B, said: 'go downstairs', expect: act('warp:7,1@38') },
  { state: B, said: 'look at the tv', expect: act('scenery:3,4@38') },
  { state: B, said: 'play the snes', expect: act('hidden:3,5@38') },
  { state: B, said: 'use the computer', expect: act('hidden:0,1@38') },
  { state: B, said: 'Move in front of the bed', expect: act('scenery:0,6@38') },
  { state: B, said: 'talk to mom', expect: impossible },
  { state: B, said: "what's in my pc?", expect: question },
  { state: B, said: 'step right', expect: act('steps:right') },
  { state: B, said: 'look at my trainer card', expect: act('startmenu:TRAINER') },

  // Oak's lab
  { state: L, said: 'talk to professor oak', expect: act('npc:5@40') },
  { state: L, said: 'talk to gary', expect: act('npc:1@40') },
  { state: L, said: 'talk to my rival', expect: act('npc:1@40') },
  { state: L, said: 'examine the poke ball', expect: clarify('npc:2@40', 'npc:3@40', 'npc:4@40') },
  { state: L, said: 'talk to the scientist', expect: clarify('npc:10@40', 'npc:11@40') },
  { state: L, said: 'read the email', expect: clarify('hidden:1,1@40', 'hidden:0,1@40') },
  { state: L, said: 'leave the lab', expect: act('warp:5,11@40') },
  { state: L, said: 'look at the pokedex', expect: clarify('npc:7@40', 'npc:6@40') },
  { state: L, said: 'talk to the girl', expect: act('npc:9@40') },
  { state: L, said: 'look at the poster on the right', expect: act('hidden:5,0@40') },
  { state: L, said: 'what pokemon should I pick?', expect: question },
  { state: L, said: 'use a potion', expect: impossible },
  { state: L, said: 'talk to the professor', expect: act('npc:5@40') },

  // A trainer battle (no running away), moves SCRATCH and GROWL
  { state: T, said: 'fight', expect: act('battle:FIGHT') },
  { state: T, said: 'use scratch', expect: act('move:SCRATCH') },
  { state: T, said: 'scratch him', expect: act('move:SCRATCH') },
  { state: T, said: 'growl', expect: act('move:GROWL') },
  { state: T, said: 'lower his attack', expect: act('move:GROWL') },
  { state: T, said: 'open my bag', expect: act('battle:ITEM') },
  { state: T, said: 'switch pokemon', expect: act('battle:PKMN') },
  { state: T, said: 'run away', expect: impossible },
  { state: T, said: 'is growl any good here?', expect: question },
  { state: T, said: 'throw a pokeball', expect: impossible },

  // A wild battle on Route 1
  { state: W, said: 'run', expect: act('run') },
  { state: W, said: 'get away from it', expect: act('run') },
  { state: W, said: 'use tackle', expect: impossible },
  { state: W, said: 'what level is that pokemon?', expect: question },
  { state: W, said: 'attack', expect: act('battle:FIGHT', 'move:SCRATCH') },

  // Viridian Forest (the player's own save)
  { state: F, said: 'Go into grass.', expect: act('terrain:grass:27,20@51') },
  { state: F, said: 'get in the grass to the east', expect: act('terrain:grass:30,17@51') },
  { state: F, said: 'talk to the bug catcher', expect: clarify('npc:3@51', 'npc:2@51', 'npc:4@51') },
  { state: F, said: 'talk to the bug catcher to the east', expect: act('npc:3@51') },
  { state: F, said: 'Pick up item.', expect: act('npc:6@51') },
  { state: F, said: 'grab that pokeball on the ground', expect: act('npc:6@51') },
  { state: F, said: 'go around the bug catcher', expect: act('terrain:past:31,19@51') },
  { state: F, said: 'use a potion', expect: act('item:POTION') },
  { state: F, said: 'heal my squirtle', expect: act('item:POTION') },
  { state: F, said: 'look at the town map', expect: act('item:TOWN MAP') },
  { state: F, said: 'go back to viridian city', expect: act('warp:17,47@51') },
  { state: F, said: 'read the nearest sign', expect: act('sign:26,17@51') },
  { state: F, said: 'save my game', expect: act('startmenu:SAVE') },
  { state: F, said: 'check my pokemon', expect: act('startmenu:POKéMON') },
  { state: F, said: 'open the pokedex', expect: act('startmenu:POKéDEX') },
  { state: F, said: 'where is the exit?', expect: question },
  { state: F, said: 'how do I beat brock', expect: question },
  { state: F, said: 'use repel', expect: impossible },
  { state: F, said: 'cut down the tree', expect: impossible },
  { state: F, said: 'Talk to the child.', expect: clarify('npc:3@51', 'npc:2@51', 'npc:8@51', 'npc:1@51', 'npc:4@51') },

  // Dialogue
  { state: D, said: 'continue', expect: act('text:next') },
  { state: D, said: 'next', expect: act('text:next') },
  { state: D, said: 'skip this', expect: act('text:next') },
  { state: D, said: 'what is this game about?', expect: question },

  // The name menu
  { state: M, said: 'new name', expect: act('menu:NEW NAME') },
  { state: M, said: 'call me ash', expect: act('menu:ASH') },
  { state: M, said: 'pick red', expect: act('menu:RED') },
  { state: M, said: 'go back', expect: act('menu:back') },
  { state: M, said: 'I want to type my own name', expect: act('menu:NEW NAME') },
];

/** Naming-screen commands: the name to type, or null when none was said, or 'question'. */
export const NAME_CASES: { said: string; expect: string | null | 'question' }[] = [
  { said: "Let's name him Shigeru", expect: 'Shigeru' },
  { said: 'My name is David.', expect: 'David' },
  { said: 'call him L E O', expect: 'LEO' },
  { said: 'uh how about Blaze', expect: 'Blaze' },
  { said: 'name it Sparky please', expect: 'Sparky' },
  { said: "let's go with LEO as the name", expect: 'LEO' },
  { said: 'Zenigame', expect: 'Zenigame' },
  { said: 'type a cool name', expect: null },
  { said: 'give it a nickname', expect: null },
  { said: "what's a good name for a charmander?", expect: 'question' },
];
