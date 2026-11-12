import type { Button } from '../../src/emu/emulator';

/** On-screen buttons. Press and hold works; a quick click is a tap. */
export function Gamepad({ down, up }: { down: (b: Button) => void; up: (b: Button) => void }) {
  const B = ({ b, label, cls = '' }: { b: Button; label: string; cls?: string }) => (
    <button
      type="button" className={`pad ${cls}`} aria-label={b} tabIndex={-1}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); down(b); }}
      onPointerUp={() => up(b)} onPointerCancel={() => up(b)}
    >{label}</button>
  );
  return (
    <div className="gamepad">
      <div className="dpad">
        <B b="UP" label="▲" cls="up" /><B b="LEFT" label="◀" cls="left" /><B b="RIGHT" label="▶" cls="right" /><B b="DOWN" label="▼" cls="down" />
      </div>
      <div className="meta"><B b="SELECT" label="SELECT" cls="wide" /><B b="START" label="START" cls="wide" /></div>
      <div className="ab"><B b="B" label="B" cls="round" /><B b="A" label="A" cls="round" /></div>
    </div>
  );
}
