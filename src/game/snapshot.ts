import type { Ctx } from '../actions/types.js';
import type { MonState } from './state.js';
import { detectMode, type Mode } from './mode.js';
import { sym } from './symbols.js';
import { buildGrid } from './world.js';

/** Everything the interface and outside agents need to know about the game right now. */
export interface GameSnapshot {
  mode: Mode; map: string; x: number; y: number; facing: string;
  /** the player's own name; '' before the game starts */
  playerName: string;
  /** the eight badges in game order (Boulder first), true when held */
  badgeList: boolean[];
  money: number; badges: number; pokedex: { seen: number; owned: number }; playTime: string;
  party: MonState[]; bag: { name: string; qty: number }[];
  /** slot: which party Pokémon is out (0 = first) */
  battle: null | { kind: 'wild' | 'trainer'; slot: number; enemy: { species: string; level: number; hp: number; maxHp: number; status: string } };
  dialog: string; running: null | { id: string; label: string };
  /** while walking around: what is on the square on each side of the player */
  around?: Record<'north' | 'south' | 'west' | 'east', string>;
}

function countBits(mem: Uint8Array, from: number, bytes: number): number {
  let n = 0;
  for (let a = from; a < from + bytes; a++) for (let b = mem[a]; b; b &= b - 1) n++;
  return n;
}

/** What is on the square on each side of the player, in a few words. */
function surroundings(ctx: Ctx): GameSnapshot['around'] {
  const { gs } = ctx;
  const g = buildGrid(ctx.emu, ctx.rom, gs);
  const taken = new Set(gs.sprites().filter((sp) => !sp.hidden).map((sp) => `${sp.x},${sp.y}`));
  const at = (dx: number, dy: number) => {
    const x = gs.x + dx, y = gs.y + dy;
    if (taken.has(`${x},${y}`)) return 'someone or something is standing there';
    if (g.water(x, y)) return 'water';
    if (!g.walkable(x, y)) return x < 0 || y < 0 || x >= g.w || y >= g.h ? 'the edge of this area' : 'blocked';
    return g.grass(x, y) ? 'tall grass' : 'open ground';
  };
  return { north: at(0, -1), south: at(0, 1), west: at(-1, 0), east: at(1, 0) };
}

export function snapshot(ctx: Ctx, running: GameSnapshot['running'] = null): GameSnapshot {
  const { gs, emu } = ctx;
  const mode = detectMode(ctx);
  const started = mode !== 'boot' && gs.mapWidth > 0;
  let battle: GameSnapshot['battle'] = null;
  if (gs.inBattle === 1 || gs.inBattle === 2) {
    const b = gs.battle();
    const { species, level, hp, maxHp, status } = b.enemy;
    battle = { kind: gs.inBattle === 1 ? 'wild' : 'trainer', slot: b.player.slot, enemy: { species, level, hp, maxHp, status } };
  }
  return {
    mode, map: started ? gs.mapName : '', x: gs.x, y: gs.y, facing: gs.facing,
    playerName: started ? gs.playerName : '',
    badgeList: Array.from({ length: 8 }, (_, i) => started && (gs.badges & (1 << i)) !== 0),
    money: started ? gs.money : 0, badges: started ? gs.badgeCount : 0,
    pokedex: { seen: started ? countBits(emu.mem, sym('wPokedexSeen'), 19) : 0, owned: started ? countBits(emu.mem, sym('wPokedexOwned'), 19) : 0 },
    playTime: `${gs.u8('wPlayTimeHours')}:${String(gs.u8('wPlayTimeMinutes')).padStart(2, '0')}`,
    party: started ? gs.party() : [], bag: started ? gs.bag().map(({ name, qty }) => ({ name, qty })) : [],
    battle, dialog: gs.screen().dialog, running,
    ...(mode === 'overworld' && started ? { around: surroundings(ctx) } : {}),
  };
}
