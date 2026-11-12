import { useEffect, useState } from 'react';
import type { Button } from '../../src/emu/emulator';
import { useConnection } from './ws';
import { GameCanvas } from './GameCanvas';
import { Gamepad } from './Gamepad';
import { PartyPanel, BattlePanel, BagPanel } from './panels';
import { VolumeControl } from './VolumeControl';
import { DEFAULT_KEYMAP, buttonFor } from './keys';

const typingInto = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

export function App() {
  const conn = useConnection();
  const { state, send } = conn;
  const [saveName, setSaveName] = useState('');

  // keyboard → game, unless the player is typing somewhere
  useEffect(() => {
    const held = new Set<Button>();
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { send({ type: 'stop' }); return; }
      if (typingInto(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
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
            <button type="button" className="stop" onClick={() => send({ type: 'stop' })}>■ Stop <kbd>Esc</kbd></button>
            <Gamepad down={(b) => send({ type: 'down', button: b })} up={(b) => send({ type: 'up', button: b })} />
          </div>
          <div className="row saves">
            <input value={saveName} onChange={(e) => setSaveName(e.target.value.replace(/[^a-z0-9_-]/gi, '-').slice(0, 40))} placeholder="save name" aria-label="Save name" list="save-names" />
            <datalist id="save-names">{conn.saves.filter((n) => !n.includes('/')).map((n) => <option key={n} value={n} />)}</datalist>
            <button type="button" disabled={!saveName} onClick={() => send({ type: 'save', name: saveName })}>Save</button>
            <button type="button" disabled={!conn.saves.includes(saveName)} onClick={() => send({ type: 'load', name: saveName })}>Load</button>
          </div>
        </section>
      </div>
      <div className="col right">
        {state && <><PartyPanel state={state} /><BattlePanel state={state} /><BagPanel state={state} /></>}
      </div>
    </main>
  );
}
