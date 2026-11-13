// Pokémon Red has no pictures for items, so the bag shows one of a few drawn icons by kind.
export type IconKind = 'ball' | 'medicine' | 'heal' | 'disc' | 'stone' | 'key' | 'box';

const HEALS = new Set(['ANTIDOTE', 'BURN HEAL', 'ICE HEAL', 'AWAKENING', 'PARLYZ HEAL', 'FULL HEAL']);
const MEDICINES = new Set(['FULL RESTORE', 'REVIVE', 'MAX REVIVE', 'ETHER', 'MAX ETHER', 'ELIXER', 'MAX ELIXER', 'FRESH WATER', 'SODA POP', 'LEMONADE',
  'RARE CANDY', 'HP UP', 'PROTEIN', 'IRON', 'CARBOS', 'CALCIUM', 'PP UP']);
const KEYS = new Set(['TOWN MAP', 'BICYCLE', "OAK'S PARCEL", 'POKEDEX', 'S.S.TICKET', 'GOLD TEETH', 'CARD KEY', 'SECRET KEY', 'LIFT KEY', 'SILPH SCOPE',
  'POKE FLUTE', 'BIKE VOUCHER', 'OLD ROD', 'GOOD ROD', 'SUPER ROD', 'ITEMFINDER', 'COIN CASE', 'EXP.ALL', 'DOME FOSSIL', 'HELIX FOSSIL', 'OLD AMBER']);

export function itemIcon(name: string): IconKind {
  const n = name.toUpperCase().replace(/É/g, 'E').trim();
  if (n.endsWith('BALL')) return 'ball';
  if (n.endsWith('POTION') || MEDICINES.has(n)) return 'medicine';
  if (HEALS.has(n)) return 'heal';
  if (/^(TM|HM)\d+/.test(n)) return 'disc';
  if (n.endsWith('STONE')) return 'stone';
  if (KEYS.has(n)) return 'key';
  return 'box';
}
