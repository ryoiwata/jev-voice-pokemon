import { useEffect, useMemo, useRef, useState } from 'react';
import type { InputMode } from '../../src/server/wire';
import { AutoSender } from './autoSend';
import { isStop } from '../../src/interpret/fastpath';

/** Where dictated or typed commands land. In Voice mode it keeps focus and sends by itself. */
export function CommandBar({ mode, delayMs, placeholder, onSend }: { mode: InputMode; delayMs: number; placeholder: string; onSend: (text: string) => void }) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const hands = mode === 'voice';
  const submit = (text: string) => { if (text.trim()) onSend(text.trim()); setValue(''); };
  const submitRef = useRef(submit); submitRef.current = submit;
  // a dictated "stop" goes out the moment it lands in the box, even on the end of a command still waiting to be sent
  const auto = useMemo(() => new AutoSender((t) => submitRef.current(t), isStop), []);

  useEffect(() => { auto.update(value, delayMs, hands); }, [auto, value, delayMs, hands]);
  useEffect(() => () => auto.cancel(), [auto]);
  // dictation types into whatever has focus, so the box takes it when the mode changes
  useEffect(() => { ref.current?.focus(); }, [mode]);

  return (
    <label className={`field ${hands ? 'listening' : ''}`}>
      {hands && <i className="ear" aria-hidden />}
      <input
        ref={ref} value={value} placeholder={placeholder} aria-label="Command"
        autoComplete="off" autoCorrect="off" spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); auto.cancel(); submit(value); } }}
        onBlur={(e) => {
          // keep focus for dictation, unless the player deliberately went to another field
          const to = e.relatedTarget as HTMLElement | null;
          if (hands && !(to && /^(INPUT|SELECT|TEXTAREA)$/.test(to.tagName))) setTimeout(() => ref.current?.focus(), 0);
        }}
      />
    </label>
  );
}
