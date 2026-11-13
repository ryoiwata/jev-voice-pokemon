// The game's names and codes, in words a player reads.

/** REDS_HOUSE_2F → Reds House 2F; POKé BALL → Poké Ball. */
export const pretty = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/(^|[\s.\-])(\p{L})/gu, (_, a, c) => a + c.toUpperCase()).replace(/\b(\d+)f\b/gi, '$1F');

const STATUS: Record<string, string> = { POISON: 'poisoned', SLEEP: 'asleep', PARALYZED: 'paralysed', BURN: 'burned', FREEZE: 'frozen' };

/** A Pokémon's condition as a word, or null when it is fine. */
export function statusWord(status: string, hp: number): string | null {
  if (hp <= 0) return 'fainted';
  if (status === 'OK') return null;
  return STATUS[status] ?? status.toLowerCase();
}

const FACING: Record<string, string> = { up: 'facing north', down: 'facing south', left: 'facing west', right: 'facing east' };
export const facingWord = (facing: string): string => FACING[facing] ?? '';

/** The eight badges in the order the game stores them. */
export const BADGE_NAMES = ['Boulder', 'Cascade', 'Thunder', 'Rainbow', 'Soul', 'Marsh', 'Volcano', 'Earth'];
