import type { InputMode } from '../../src/server/wire';

const MODES: { id: InputMode; label: string; hint: string }[] = [
  { id: 'voice', label: 'Voice', hint: 'Dictated commands send themselves' },
  { id: 'text', label: 'Text', hint: 'Type a command and press Enter' },
];

export function ModeSwitch({ mode, onChange }: { mode: InputMode; onChange: (m: InputMode) => void }) {
  return (
    <div className="modes" role="radiogroup" aria-label="Input mode">
      {MODES.map((m) => (
        <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} title={m.hint} className={mode === m.id ? 'on' : ''} onClick={() => onChange(m.id)}>{m.label}</button>
      ))}
    </div>
  );
}
