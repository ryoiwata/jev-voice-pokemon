import { useEffect, useRef } from 'react';
import type { Button } from '../../src/emu/emulator';
import { BUTTONS } from '../../src/server/wire';
import type { Connection } from './ws';
import type { PressTracker } from './pressed';
import { GameCanvas } from './GameCanvas';

const NAMES: Record<Button, string> = { A: 'A', B: 'B', START: 'Start', SELECT: 'Select', UP: 'Up', DOWN: 'Down', LEFT: 'Left', RIGHT: 'Right' };

/** One console button. Defined at module level so a redraw of the page never replaces a button that is being held. */
function Pad({ b, cls, children, tracker, down, up, els }: {
  b: Button; cls: string; children?: React.ReactNode; tracker: PressTracker; down: (b: Button) => void; up: (b: Button) => void; els: Map<Button, HTMLButtonElement>;
}) {
  const held = useRef(false);
  const press = () => { if (held.current) return; held.current = true; tracker.local(b, true); down(b); };
  // however the press ends (release, cancel, the browser taking the pointer away), let go exactly once
  const release = () => { if (!held.current) return; held.current = false; tracker.local(b, false); up(b); };
  return (
    <button
      type="button" className={cls} aria-label={NAMES[b]} tabIndex={-1}
      ref={(el) => { if (el) els.set(b, el); else els.delete(b); }}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); press(); }}
      onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
    >{children}</button>
  );
}

/**
 * The handheld the game runs on. Its buttons are real buttons (press and hold works), and they are
 * drawn pressed whenever the game receives that button, whoever sent it.
 */
export function Console({ conn, tracker, down, up, onTile }: {
  conn: Connection; tracker: PressTracker; down: (b: Button) => void; up: (b: Button) => void; onTile: (col: number, row: number) => void;
}) {
  const els = useRef(new Map<Button, HTMLButtonElement>());

  // 60 times a second, outside React: light the buttons the tracker says are down
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const on = new Set(tracker.shown(performance.now()));
      for (const b of BUTTONS) els.current.get(b)?.classList.toggle('on', on.has(b));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tracker]);

  const pad = { tracker, down, up, els: els.current };

  return (
    <div className="gba" tabIndex={0} role="group" aria-label="Game console. While it has focus, the keyboard plays: arrows move, Z is A, X is B, Enter is Start, Shift is Select.">
      <div className="shoulder l" aria-hidden>L</div><div className="shoulder r" aria-hidden>R</div>
      <div className="wing">
        <div className="dpad"><i />
          <Pad {...pad} b="UP" cls="u">▲</Pad><Pad {...pad} b="LEFT" cls="l">◀</Pad><Pad {...pad} b="RIGHT" cls="r">▶</Pad><Pad {...pad} b="DOWN" cls="d">▼</Pad>
        </div>
        <div className="pills"><Pad {...pad} b="START" cls="pill">START</Pad><Pad {...pad} b="SELECT" cls="pill">SELECT</Pad></div>
      </div>
      <div className="bezel">
        <div className="lcd">
          <GameCanvas conn={conn} tracker={tracker} onTile={onTile} />
          {!conn.connected && <div className="lost" role="status">Reconnecting…</div>}
        </div>
        <div className="mark" aria-hidden>VOICE BOY</div>
      </div>
      <div className="wing">
        <div className="ab"><Pad {...pad} b="B" cls="b">B</Pad><Pad {...pad} b="A" cls="a">A</Pad></div>
        <div className="grille" aria-hidden><b /><b /><b /><b /><b /></div>
      </div>
      <div className={`power ${conn.connected ? '' : 'off'}`} aria-hidden><i />POWER</div>
    </div>
  );
}
