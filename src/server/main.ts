import './env.js';
import fs from 'node:fs';
import { Emulator } from '../emu/emulator.js';
import { Rom } from '../game/rom.js';
import { GameState } from '../game/state.js';
import { newMemory } from '../actions/types.js';
import { detectMode } from '../game/mode.js';

const buf = fs.readFileSync(process.env.ROM_PATH ?? 'roms/red.gb');
const emu = new Emulator(buf);
const ctx = { emu, rom: new Rom(buf), gs: new GameState(emu, new Rom(buf)), mem: newMemory(), log: () => {} };
console.log(`booted: mode=${detectMode(ctx)}`);
