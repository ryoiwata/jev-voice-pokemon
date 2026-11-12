import { useEffect, useRef, useState } from 'react';
import type { Button } from '../../src/emu/emulator';
import { useConnection } from './ws';
import { GameCanvas } from './GameCanvas';
import { Gamepad } from './Gamepad';
import { PartyPanel, BattlePanel, BagPanel } from './panels';
import { VolumeControl } from './VolumeControl';
import { DEFAULT_KEYMAP, buttonFor } from './keys';
import { CommandBar } from './CommandBar';
import { ModeSwitch } from './ModeSwitch';
import { Log } from './Log';
import { Settings } from './Settings';

const stored = (k: string, d: number) => { try { const v = localStorage.getItem(k); return v === null ? d : +v; } catch { return d; } };

const typingInto = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

export function App() {
  const conn = useConnection();
  const { state, send } = conn;
  const [saveName, setSaveName] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [sendDelay, setSendDelayState] = useState(() => stored('sendDelay', 800));
  const setSendDelay = (ms: number) => { setSendDelayState(ms); try { localStorage.setItem('sendDelay', String(ms)); } catch { /* fine without */ } };
  const mode = conn.session?.mode ?? 'voice';
  const modeRef = useRef(mode); modeRef.current = mode;
  // the newest "did you mean" is the only one that can still be answered
  const lastEntry = conn.log[conn.log.length - 1];
  const openQuestion = lastEntry?.status === 'asking' ? lastEntry.id : null;

  // keyboard → game, unless the player is typing somewhere
  useEffect(() => {
    const held = new Set<Button>();
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { send({ type: 'stop' }); return; }
      if (modeRef.current !== 'controls' || typingInto(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const b = buttonFor(e, DEFAULT_KEYMAP);
      if (!b) return;
      e.preventDefault();
      if (!held.has(b)) { held.add(b); send({ type: 'down', button: b }); }
    };
    const up = (e: KeyboardEvent) => {
      const b = buttonFor(e, DEFAULT_KEYMAP);
      if (b && held.delete(b)) send({ type: 'up', button: b });
    };
    const blur = () => { for (const b of held) send({ type: 'up', button: b }); held.clear(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [send]);

  return (
    <main className="page">
      <div className="col left">
        <section className="panel screen">
          <h2>Game <span>{conn.connected ? 'click a spot to walk there' : 'connecting…'}</span><VolumeControl conn={conn} /></h2>
          <GameCanvas conn={conn} onTile={(col, row) => send({ type: 'click', col, row })} />
        </section>
        <section className="panel controls">
          <div className="row">
            <ModeSwitch mode={mode} onChange={(m) => send({ type: 'set', key: 'mode', value: m })} />
            {conn.session && <span className={`badge ${conn.session.jev}`} title="Which model works out what a command means">Jev: {conn.session.jev === 'gateway' ? 'live' : 'stand-in'}</span>}
          </div>
          <div className="row">
            <CommandBar mode={mode} delayMs={sendDelay} onSend={(text) => send({ type: 'text', text })} />
          </div>
          <div className="row">
            <button type="button" className="stop" onClick={() => send({ type: 'stop' })}>■ Stop <kbd>Esc</kbd></button>
            <Gamepad down={(b) => send({ type: 'down', button: b })} up={(b) => send({ type: 'up', button: b })} />
          </div>
          <div className="row saves">
            <input value={saveName} onChange={(e) => setSaveName(e.target.value.replace(/[^a-z0-9_-]/gi, '-').slice(0, 40))} placeholder="save name" aria-label="Save name" list="save-names" />
            <datalist id="save-names">{conn.saves.filter((n) => !n.includes('/')).map((n) => <option key={n} value={n} />)}</datalist>
            <button type="button" disabled={!saveName} onClick={() => send({ type: 'save', name: saveName })}>Save</button>
            <button type="button" disabled={!conn.saves.includes(saveName)} onClick={() => send({ type: 'load', name: saveName })}>Load</button>
            <button type="button" aria-expanded={showSettings} onClick={() => setShowSettings((v) => !v)}>Settings</button>
          </div>
          {showSettings && conn.session && <Settings info={conn.session} set={(key, value) => send({ type: 'set', key, value })} sendDelay={sendDelay} setSendDelay={setSendDelay} />}
        </section>
        <section className="panel">
          <h2>Log</h2>
          <Log entries={conn.log} openQuestion={openQuestion} onChoose={(logId, index) => send({ type: 'choose', logId, index })} />
        </section>
      </div>
      <div className="col right">
        {state && <><PartyPanel state={state} /><BattlePanel state={state} /><BagPanel state={state} /></>}
      </div>
    </main>
  );
}
