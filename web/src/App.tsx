import { useEffect, useMemo, useState } from 'react';
import type { Button } from '../../src/emu/emulator';
import { useConnection } from './ws';
import { Console } from './Console';
import { CommandArea } from './CommandArea';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { GameAudio } from './audio';
import { PressTracker } from './pressed';
import { DEFAULT_KEYMAP, buttonFor } from './keys';

const stored = (k: string, d: number) => { try { const v = localStorage.getItem(k); return v === null ? d : +v; } catch { return d; } };
const typingInto = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

export function App() {
  const conn = useConnection();
  const { state, send } = conn;
  const tracker = useMemo(() => new PressTracker(), []);
  const audio = useMemo(() => new GameAudio(), []);
  const [sendDelay, setSendDelayState] = useState(() => stored('sendDelay', 800));
  const setSendDelay = (ms: number) => { setSendDelayState(ms); try { localStorage.setItem('sendDelay', String(ms)); } catch { /* fine without */ } };
  const mode = conn.session?.mode ?? 'voice';

  // the game's sound; browsers hold it back until the first click or key press
  useEffect(() => {
    conn.onAudio.current = (pcm) => audio.push(pcm);
    const wake = () => { if (audio.needsGesture) void audio.resume(); };
    window.addEventListener('pointerdown', wake); window.addEventListener('keydown', wake);
    return () => { conn.onAudio.current = null; window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake); };
  }, [audio, conn.onAudio]);

  // each new command starts a fresh trail of presses; done as the entry arrives so no press is lost to a late redraw
  useEffect(() => {
    let last = '';
    conn.onLog.current = (entry) => { if (entry.chose && entry.id !== last) { last = entry.id; tracker.clearTrail(); } };
    return () => { conn.onLog.current = null; };
  }, [conn.onLog, tracker]);

  // Esc always stops. The other keys play the game whenever the player is not typing somewhere.
  useEffect(() => {
    const held = new Set<Button>();
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { send({ type: 'stop' }); return; }
      if (typingInto(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const b = buttonFor(e, DEFAULT_KEYMAP);
      if (!b) return;
      e.preventDefault();
      if (!held.has(b)) { held.add(b); tracker.local(b, true); send({ type: 'down', button: b }); }
    };
    const up = (e: KeyboardEvent) => {
      const b = buttonFor(e, DEFAULT_KEYMAP);
      if (b && held.delete(b)) { tracker.local(b, false); send({ type: 'up', button: b }); }
    };
    const blur = () => { for (const b of held) { tracker.local(b, false); send({ type: 'up', button: b }); } held.clear(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [send, tracker]);

  return (
    <div className="page">
      <main>
        <TopBar conn={conn} audio={audio} sendDelay={sendDelay} setSendDelay={setSendDelay} />
        <Console
          conn={conn} tracker={tracker}
          down={(b) => send({ type: 'down', button: b })} up={(b) => send({ type: 'up', button: b })}
          onTile={(col, row) => send({ type: 'click', col, row })}
        />
        <CommandArea conn={conn} tracker={tracker} mode={mode} sendDelay={sendDelay} />
      </main>
      {state && <Sidebar state={state} />}
    </div>
  );
}
