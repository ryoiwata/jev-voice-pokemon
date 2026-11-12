import { useEffect, useMemo, useRef, useState } from 'react';
import type { InputMode } from '../../src/server/wire';
import { AutoSender } from './autoSend';

const PLACEHOLDER: Record<InputMode, string> = {
  voice: 'Dictate a command: it sends itself when you stop',
  text: 'Type a command, then press Enter',
  controls: 'Keyboard is playing the game. Click here to type instead',
  agent: 'An agent has the controls. Say "stop" or "voice mode" to take over',
};

/** Where dictated or typed commands land. In Voice (and Agent) mode it keeps focus and sends by itself. */
export function CommandBar({ mode, delayMs, onSend }: { mode: InputMode; delayMs: number; onSend: (text: string) => void }) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const hands = mode === 'voice' || mode === 'agent';
  const submit = (text: string) => { if (text.trim()) onSend(text.trim()); setValue(''); };
  const submitRef = useRef(submit); submitRef.current = submit;
  const auto = useMemo(() => new AutoSender((t) => submitRef.current(t)), []);

  useEffect(() => { auto.update(value, delayMs, hands); }, [auto, value, delayMs, hands]);
  useEffect(() => () => auto.cancel(), [auto]);
  // dictation types into whatever has focus, so in the hands-free modes the box takes it and keeps it
  useEffect(() => {
    if (mode === 'controls') { ref.current?.blur(); return; }
    ref.current?.focus();
  }, [mode]);

  return (
    <input
      ref={ref} className={`command ${hands ? 'listening' : ''}`} value={value} placeholder={PLACEHOLDER[mode]} aria-label="Command"
      autoComplete="off" autoCorrect="off" spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); auto.cancel(); submit(value); } }}
      onBlur={(e) => {
        // keep focus for dictation, unless the player deliberately went to another field
        const to = e.relatedTarget as HTMLElement | null;
        if (hands && !(to && /^(INPUT|SELECT|TEXTAREA)$/.test(to.tagName))) setTimeout(() => ref.current?.focus(), 0);
      }}
    />
  );
}
