import type { Ctx } from '../actions/types.js';
import type { MonState } from './state.js';
import { detectMode, type Mode } from './mode.js';
import { sym } from './symbols.js';

/** Everything the interface and outside agents need to know about the game right now. */
export interface GameSnapshot {
  mode: Mode; map: string; x: number; y: number; facing: string;
  money: number; badges: number; pokedex: { seen: number; owned: number }; playTime: string;
  party: MonState[]; bag: { name: string; qty: number }[];
  battle: null | { kind: 'wild' | 'trainer'; enemy: { species: string; level: number; hp: number; maxHp: number; status: string } };
  dialog: string; running: null | { id: string; label: string };
}

function countBits(mem: Uint8Array, from: number, bytes: number): number {
  let n = 0;
  for (let a = from; a < from + bytes; a++) for (let b = mem[a]; b; b &= b - 1) n++;
  return n;
}

export function snapshot(ctx: Ctx, running: GameSnapshot['running'] = null): GameSnapshot {
  const { gs, emu } = ctx;
  const mode = detectMode(ctx);
  const started = mode !== 'boot' && gs.mapWidth > 0;
  let battle: GameSnapshot['battle'] = null;
  if (gs.inBattle === 1 || gs.inBattle === 2) {
    const b = gs.battle();
    const { species, level, hp, maxHp, status } = b.enemy;
    battle = { kind: gs.inBattle === 1 ? 'wild' : 'trainer', enemy: { species, level, hp, maxHp, status } };
  }
  return {
    mode, map: started ? gs.mapName : '', x: gs.x, y: gs.y, facing: gs.facing,
    money: started ? gs.money : 0, badges: started ? gs.badgeCount : 0,
    pokedex: { seen: started ? countBits(emu.mem, sym('wPokedexSeen'), 19) : 0, owned: started ? countBits(emu.mem, sym('wPokedexOwned'), 19) : 0 },
    playTime: `${gs.u8('wPlayTimeHours')}:${String(gs.u8('wPlayTimeMinutes')).padStart(2, '0')}`,
    party: started ? gs.party() : [], bag: started ? gs.bag().map(({ name, qty }) => ({ name, qty })) : [],
    battle, dialog: gs.screen().dialog, running,
  };
}
