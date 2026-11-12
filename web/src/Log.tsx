import { useEffect, useRef } from 'react';
import type { LogEntry } from '../../src/server/wire';

const MARK: Record<LogEntry['status'], string> = { running: '→', done: '✓', failed: '✕', stopped: '■', asking: '?', answer: '💬', info: '·' };

/** What was heard, what was understood, what happened. Questions to the player show as buttons. */
export function Log({ entries, openQuestion, onChoose }: { entries: LogEntry[]; openQuestion: string | null; onChoose: (logId: string, index: number) => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [entries]);
  return (
    <div className="log" role="log" aria-live="polite">
      {entries.length === 0 && <p className="dim">Nothing yet. Try “open the menu”, “left three”, or ask a question.</p>}
      {entries.map((e) => (
        <div key={e.id} className={`entry ${e.status}`}>
          {e.heard && <div className="heard">{e.source === 'agent' ? 'agent' : 'heard'}: “{e.heard}”</div>}
          <div className="said"><span className="mark" aria-hidden>{MARK[e.status]}</span> {e.text}</div>
          {e.choices && (
            <div className="choices">
              {e.choices.map((c, i) => (
                <button key={c.id} type="button" disabled={e.id !== openQuestion} onClick={() => onChoose(e.id, i)}><b>{i + 1}</b> {c.label}</button>
              ))}
            </div>
          )}
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}
