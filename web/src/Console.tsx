import { useEffect, useRef } from 'react';
import type { Button } from '../../src/emu/emulator';
import { BUTTONS } from '../../src/server/wire';
import type { Connection } from './ws';
import type { PressTracker } from './pressed';
import { GameCanvas } from './GameCanvas';

const NAMES: Record<Button, string> = { A: 'A', B: 'B', START: 'Start', SELECT: 'Select', UP: 'Up', DOWN: 'Down', LEFT: 'Left', RIGHT: 'Right' };

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

  const B = ({ b, cls, children }: { b: Button; cls: string; children?: React.ReactNode }) => (
    <button
      type="button" className={cls} aria-label={NAMES[b]} tabIndex={-1}
      ref={(el) => { if (el) els.current.set(b, el); else els.current.delete(b); }}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); tracker.local(b, true); down(b); }}
      onPointerUp={() => { tracker.local(b, false); up(b); }}
      onPointerCancel={() => { tracker.local(b, false); up(b); }}
    >{children}</button>
  );

  return (
    <div className="gba" tabIndex={0} aria-label="Game console. While it has focus, the keyboard plays: arrows move, Z is A, X is B, Enter is Start, Shift is Select.">
      <div className="shoulder l" aria-hidden>L</div><div className="shoulder r" aria-hidden>R</div>
      <div className="wing">
        <div className="dpad"><i />
          <B b="UP" cls="u">▲</B><B b="LEFT" cls="l">◀</B><B b="RIGHT" cls="r">▶</B><B b="DOWN" cls="d">▼</B>
        </div>
        <div className="pills"><B b="START" cls="pill">START</B><B b="SELECT" cls="pill">SELECT</B></div>
      </div>
      <div className="bezel">
        <div className="lcd">
          <GameCanvas conn={conn} tracker={tracker} onTile={onTile} />
          {!conn.connected && <div className="lost" role="status">Reconnecting…</div>}
        </div>
        <div className="mark" aria-hidden>VOICE BOY</div>
      </div>
      <div className="wing">
        <div className="ab"><B b="B" cls="b">B</B><B b="A" cls="a">A</B></div>
        <div className="grille" aria-hidden><b /><b /><b /><b /><b /></div>
      </div>
      <div className={`power ${conn.connected ? '' : 'off'}`} aria-hidden><i />POWER</div>
    </div>
  );
}
