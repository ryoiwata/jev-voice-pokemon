import type { Ctx } from '../actions/types.js';
import { isNamingScreen } from '../actions/nav.js';
import { sym } from './symbols.js';

export type Mode = 'battle' | 'dialog' | 'overworld' | 'busy' | 'boot';

/** What kind of situation the game is in right now (read from memory; same rules as the reference agent). */
export function detectMode(ctx: Ctx): Mode {
  const { gs } = ctx;
  if (gs.inBattle) return 'battle';
  const s = gs.screen();
  if (s.hasTextBox || s.cursor || isNamingScreen(ctx)) return 'dialog';
  // cutscene / scripted movement: directions ignored or simulated joypad active
  if ((gs.joyIgnore & 0xf0) || (gs.u8('wStatusFlags5') & 0x80) || ctx.emu.mem[sym('wWalkCounter')] !== 0) return 'busy';
  if (ctx.emu.mem[0xc100] !== 0 && gs.mapWidth > 0 && s.nonMapTiles === 0) return 'overworld';
  if (s.nonMapTiles > 0) return 'dialog'; // full-screen UI (Pokédex page, etc.)
  return 'boot';
}
