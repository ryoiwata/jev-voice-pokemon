import { useEffect, useRef, useState } from 'react';
import type { GameAudio } from './audio';
import type { Connection } from './ws';

type Panel = 'sound' | 'saves' | 'settings';

/** The name, whether Jev is connected, and the three small panels: Sound, Saves, Settings. */
export function TopBar({ conn, audio, sendDelay, setSendDelay }: { conn: Connection; audio: GameAudio; sendDelay: number; setSendDelay: (ms: number) => void }) {
  const { session, send, saves } = conn;
  const [open, setOpen] = useState<Panel | null>(null);
  const [saveName, setSaveName] = useState('');
  const [, redraw] = useState(0);
  const tick = () => redraw((n) => n + 1);
  const root = useRef<HTMLDivElement>(null);

  // Esc and a click elsewhere close the open panel. (Esc also stops the game: App handles that, always.)
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    const click = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(null); };
    window.addEventListener('keydown', key); window.addEventListener('pointerdown', click);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', click); };
  }, [open]);

  const set = (key: 'autoAdvance' | 'advancePaceMs' | 'speed', value: unknown) => send({ type: 'set', key, value });
  const named = saves.filter((n) => !n.includes('/'));
  const tab = (id: Panel, label: string) => (
    <button type="button" className="tool" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>{label}</button>
  );

  return (
    <header className="head" ref={root}>
      <h1>Jev Voice Pokémon</h1>
      {session && (
        <span className={`jev ${session.jev}`} title={session.jev === 'gateway' ? 'Jev is choosing what each command means.' : 'No TypeSafe key is set, so a simple word-matcher is choosing.'}>
          <i />{session.jev === 'gateway' ? 'Jev is connected' : 'Using the stand-in'}
        </span>
      )}
      <span className="gap" />
      {tab('sound', audio.muted ? 'Sound off' : 'Sound')}{tab('saves', 'Saves')}{tab('settings', 'Settings')}

      {open === 'sound' && (
        <div className="pop" role="group" aria-label="Sound">
          {audio.needsGesture && <p className="note">Your browser starts sound after the first click or key press.</p>}
          <label className="check"><input type="checkbox" checked={!audio.muted} onChange={(e) => { audio.setMuted(!e.target.checked); tick(); }} /> Game sound</label>
          <label>Volume
            <input type="range" min={0} max={1} step={0.05} value={audio.volume} onChange={(e) => { audio.setVolume(+e.target.value); tick(); }} />
          </label>
        </div>
      )}

      {open === 'saves' && (
        <div className="pop" role="group" aria-label="Saves">
          <label>Save name
            <input value={saveName} onChange={(e) => setSaveName(e.target.value.replace(/[^a-z0-9_-]/gi, '-').slice(0, 40))} placeholder="before-brock" />
          </label>
          <div className="row">
            <button type="button" disabled={!saveName} onClick={() => send({ type: 'save', name: saveName })}>Save here</button>
            <button type="button" disabled={!saves.includes(saveName)} onClick={() => send({ type: 'load', name: saveName })}>Load it</button>
          </div>
          {named.length > 0 && <ul className="savelist">{named.map((n) => <li key={n}><button type="button" className="link" onClick={() => setSaveName(n)}>{n}</button></li>)}</ul>}
          <p className="note">The game also saves itself every five minutes and when it closes.</p>
        </div>
      )}

      {open === 'settings' && session && (
        <div className="pop" role="group" aria-label="Settings">
          <label className="check"><input type="checkbox" checked={session.autoAdvance} onChange={(e) => set('autoAdvance', e.target.checked)} /> Continue dialogue by itself</label>
          <label>Reading time
            <select value={session.advancePaceMs} onChange={(e) => set('advancePaceMs', +e.target.value)}>{[800, 1500, 2500, 4000].map((ms) => <option key={ms} value={ms}>{ms / 1000} s</option>)}</select>
          </label>
          <label>Voice sends after
            <select value={sendDelay} onChange={(e) => setSendDelay(+e.target.value)}>{[500, 800, 1200, 2000].map((ms) => <option key={ms} value={ms}>{ms / 1000} s</option>)}</select>
          </label>
          <label>Game speed
            <select value={session.speed} onChange={(e) => set('speed', +e.target.value)}>{[1, 2, 4].map((x) => <option key={x} value={x}>{x}×</option>)}</select>
          </label>
          <p className="note">Keys, when you are not typing: arrows move, Z is A, X is B, Enter is Start, Shift is Select. Esc always stops.</p>
        </div>
      )}
    </header>
  );
}
