// The game thread. Owns the emulator, runs it in real time, and carries out one action at a time.
// The reference's navigation code blocks while it presses buttons, so everything that must get through
// during an action (stop, held buttons, settings) arrives through the shared Control block instead.
import fs from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { Emulator } from '../emu/emulator.js';
import { toPng } from '../emu/png.js';
import { Rom } from '../game/rom.js';
import { GameState } from '../game/state.js';
import { snapshot, type GameSnapshot } from '../game/snapshot.js';
import { newMemory, type Ctx, type ActionResult } from '../actions/types.js';
import { listActions, runAction } from '../actions/index.js';
import { tap } from '../actions/nav.js';
import { Control, Slot, StopError } from './control.js';

const { sab, romPath, resume, autosave } = workerData as { sab: SharedArrayBuffer; romPath: string; resume?: string; autosave: boolean };
const port = parentPort!;
const ctl = new Control(sab);
const romBuf = fs.readFileSync(romPath);
const emu = new Emulator(romBuf);
const rom = new Rom(romBuf);
const gs = new GameState(emu, rom);
const ctx: Ctx = { emu, rom, gs, mem: newMemory(), log: (kind, msg) => port.postMessage({ type: 'log', kind, msg }) };

const statePath = (name: string) => path.join('saves', `${name}.state.json`);
function save(name: string) {
  fs.mkdirSync(path.dirname(statePath(name)), { recursive: true });
  emu.saveState(statePath(name));
}
if (resume && fs.existsSync(statePath(resume))) emu.loadState(statePath(resume));
emu.attachControl(ctl);

// ---- audio: collect sample pairs into chunks (only at normal speed; anything else would be the wrong pitch)
const CHUNK = 2048;
let audio = new Int16Array(CHUNK * 2), audioN = 0;
emu.onAudio = (l, r) => {
  if (ctl.get(Slot.SPEED_X100) !== 100) return;
  audio[audioN++] = Math.max(-32768, Math.min(32767, Math.round(l * 32767)));
  audio[audioN++] = Math.max(-32768, Math.min(32767, Math.round(r * 32767)));
  if (audioN === CHUNK * 2) {
    port.postMessage({ type: 'audio', samples: audio }, [audio.buffer]);
    audio = new Int16Array(CHUNK * 2); audioN = 0;
  }
};
emu.enableAudioTap();

// ---- pacing + pushing frames and state out (runs for every emulator slice, also in the middle of an action)
const SLICES_PER_SEC = 4194304 / (emu.core.baseCPUCyclesPerIteration || 33554.432);
const sleepCell = new Int32Array(new SharedArrayBuffer(4));
let paceStart = Date.now(), paceSlices = 0, paceSpeed = 100;
let lastFrameSent = 0, lastStateAt = 0, lastStateJson = '';
let running: GameSnapshot['running'] = null;

function pushState(force = false) {
  const now = Date.now();
  if (!force && now - lastStateAt < 200) return;
  lastStateAt = now;
  const snap = snapshot(ctx, running);
  const json = JSON.stringify(snap);
  if (json === lastStateJson) return;
  lastStateJson = json;
  port.postMessage({ type: 'state', state: snap });
}

emu.onFrame = (screen) => {
  const speed = ctl.get(Slot.SPEED_X100);
  if (speed !== paceSpeed) { paceSpeed = speed; paceStart = Date.now(); paceSlices = 0; }
  if (speed > 0) {
    // fixed timeline: catches up after slow logic instead of drifting
    paceSlices++;
    const target = paceStart + (paceSlices * 1000) / (SLICES_PER_SEC * (speed / 100));
    const now = Date.now();
    if (target > now + 1) Atomics.wait(sleepCell, 0, 0, target - now);
    else if (now - target > 250) { paceStart = now; paceSlices = 0; }
  }
  const now = Date.now();
  if (now - lastFrameSent >= 16) {
    lastFrameSent = now;
    const buf = Uint8Array.from(screen as ArrayLike<number>);
    port.postMessage({ type: 'frame', frame: buf }, [buf.buffer]);
  }
  pushState();
};

// ---- the action list, refreshed while idle
let lastActionsKey = '';
function pushActions() {
  const actions = listActions(ctx);
  const key = JSON.stringify(actions.map((a) => a.id));
  if (key === lastActionsKey) return;
  lastActionsKey = key;
  port.postMessage({ type: 'actions', actions });
}

function run(id: string, arg: unknown): ActionResult {
  const label = listActions(ctx).find((a) => a.id === id)?.label ?? id;
  running = { id, label };
  ctl.set(Slot.STOP, 0);
  ctl.set(Slot.RUNNING, 1);
  pushState(true);
  try {
    return runAction(ctx, id, arg);
  } catch (e) {
    if (e instanceof StopError) return { status: 'stopped', message: 'Stopped.' };
    ctx.log('error', String((e as Error).stack ?? e));
    return { status: 'failed', message: 'Something went wrong doing that.' };
  } finally {
    ctl.set(Slot.RUNNING, 0);
    ctl.set(Slot.STOP, 0);
    running = null;
    pushState(true);
    pushActions();
  }
}

// ---- dialogue auto-advance: plain text that only wants A, at a readable pace; never when a choice is showing
let advText = '', advSince = Date.now();
function autoAdvance() {
  if (!ctl.get(Slot.AUTO_ADVANCE)) { advText = ''; return; }
  const s = gs.screen();
  if (!s.waitingForA || s.cursor) { advText = ''; advSince = Date.now(); return; }
  if (s.dialog !== advText) { advText = s.dialog; advSince = Date.now(); return; }
  if (Date.now() - advSince >= ctl.get(Slot.ADVANCE_PACE_MS)) { tap(ctx, 'A', 4); advText = ''; advSince = Date.now(); }
}

// ---- requests from the main thread (handled between idle frames)
let alive = true;
port.on('message', (m: { id: number; op: string; args: any }) => {
  let result: unknown, error: string | undefined;
  try {
    switch (m.op) {
      case 'run': result = run(m.args.id, m.args.arg); break;
      case 'save': save(m.args.name); break;
      case 'load': {
        if (!fs.existsSync(statePath(m.args.name))) throw new Error(`No save called "${m.args.name}".`);
        emu.loadState(statePath(m.args.name));
        emu.attachControl(ctl);
        pushState(true); pushActions();
        break;
      }
      case 'screenPng': result = toPng(emu.screen(), 160, 144, 2); break;
      case 'shutdown': if (autosave) save('autosave'); alive = false; break;
      default: throw new Error(`unknown op ${m.op}`);
    }
  } catch (e) { error = (e as Error).message; }
  port.postMessage({ type: 'reply', id: m.id, ok: !error, result, error });
});

let lastAutosave = Date.now(), tick = 0;
async function loop() {
  pushState(true);
  port.postMessage({ type: 'ready' });
  while (alive) {
    for (let i = 0; i < 4; i++) emu.frame();
    autoAdvance();
    if (tick++ % 6 === 0) pushActions();
    if (autosave && Date.now() - lastAutosave > 5 * 60_000) { save('autosave'); lastAutosave = Date.now(); }
    await new Promise((r) => setImmediate(r));
  }
  process.exit(0);
}
loop();
