import { useEffect, useState } from 'react';
import type { Button } from '../../src/emu/emulator';
import type { InputMode, LogEntry } from '../../src/server/wire';
import type { Connection } from './ws';
import type { PressTracker } from './pressed';
import { laneView, stripWords } from './lane';
import { CommandBar } from './CommandBar';

const GLYPH: Record<Button, string> = { UP: '▲', DOWN: '▼', LEFT: '◀', RIGHT: '▶', A: 'A', B: 'B', START: 'START', SELECT: 'SELECT' };
const MARK: Record<LogEntry['status'], [string, string]> = {
  running: ['→', 'run'], done: ['✓', 'done'], failed: ['✕', 'no'], stopped: ['■', 'halt'], asking: ['?', 'ask'], answer: ['✦', 'ans'], info: ['·', 'info'],
};
const EXAMPLES = ['walk to the door', 'talk to mom', 'what is Onix weak to?'];
const HISTORY = 30;

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
/** "Take the stairs (3 steps) → You went downstairs." → the part after the arrow, if any. */
const outcome = (text: string) => { const i = text.indexOf(' → '); return i < 0 ? '' : text.slice(i + 3); };

/** The buttons the game has received for the current command, newest lit. */
function Trail({ tracker, live }: { tracker: PressTracker; live: boolean }) {
  const [keys, setKeys] = useState<Button[]>([]);
  useEffect(() => {
    const read = () => setKeys((old) => { const next = tracker.trail(); return next.length === old.length && next.every((b, i) => b === old[i]) ? old : next; });
    read();
    const t = setInterval(read, 80);
    return () => clearInterval(t);
  }, [tracker]);
  if (!keys.length) return <div className="keys"><span className="none">{live ? 'Nothing yet' : 'No buttons'}</span></div>;
  return <div className="keys">{keys.map((b, i) => <b key={i} className={live && i === keys.length - 1 ? 'now' : ''}>{GLYPH[b]}</b>)}</div>;
}

function Earlier({ entries }: { entries: LogEntry[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!entries.length) return null;
  return (
    <div className="past">
      <h2>Earlier</h2>
      <ol>
        {entries.map((e) => {
          const [mark, cls] = MARK[e.status];
          const isAnswer = e.status === 'answer';
          return (
            <li key={e.id}>
              <span className={`s-${cls}`} aria-hidden>{mark}</span>
              <div>
                {e.heard && <q>{e.heard}</q>}{' '}
                {isAnswer
                  ? <button type="button" className="link" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>Answered</button>
                  : e.status === 'asking' ? 'Asked which you meant' : e.text}
                {e.source === 'agent' && <span className="by">agent</span>}
                {isAnswer && open === e.id && <p className="full">{e.text}</p>}
              </div>
              <time>{clock(e.at)}</time>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The switch, the box, Stop, and what is happening right now. */
export function CommandArea({ conn, tracker, mode, sendDelay }: { conn: Connection; tracker: PressTracker; mode: InputMode; sendDelay: number }) {
  const { send, log } = conn;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const view = laneView(log, Math.max(now, Date.now()));
  const current = view.kind === 'idle' ? null : view.entry;

  const earlier = log.filter((e) => e !== current && e.status !== 'running').slice(-HISTORY).reverse();
  const placeholder = view.kind === 'ask' ? 'Say “one”, “two” or “three”.'
    : mode === 'voice' ? 'Listening. Say what you want to do.' : 'Type what you want to do, then press Enter.';

  return (
    <section className="lane" aria-label="Commands">
      <div className="say">
        <div className="switch" role="radiogroup" aria-label="How you give commands">
          {(['voice', 'text'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => send({ type: 'set', key: 'mode', value: m })}
              title={m === 'voice' ? 'Dictated commands send themselves' : 'Type a command and press Enter'}>{m === 'voice' ? 'Voice' : 'Text'}</button>
          ))}
        </div>
        <CommandBar mode={mode} delayMs={sendDelay} placeholder={placeholder} onSend={(text) => send({ type: 'text', text })} />
        <button type="button" className="halt" onClick={() => send({ type: 'stop' })}>Stop <kbd>Esc</kbd></button>
      </div>

      <div aria-live="polite">
        {view.kind === 'idle' && (
          <p className="quiet">Say or type what you want to do. For example: {EXAMPLES.map((x, i) => <span key={x}>{i > 0 && ', '}<q>{x}</q></span>)}.</p>
        )}

        {view.kind === 'strip' && (() => {
          const w = stripWords(view.entry);
          const result = outcome(view.entry.text);
          return (
            <div className={`trace ${view.live ? 'live' : view.entry.status}`}>
              <div><small>{w.saidLabel}</small><strong>{w.said}</strong></div>
              <div><small>{w.choseLabel}</small><strong>{w.chose}{w.sure && <span className="sure">{w.sure}</span>}</strong></div>
              <div><small>{view.live ? 'Pressing' : 'Pressed'} {w.pressingFor}</small><Trail tracker={tracker} live={view.live} /></div>
              {!view.live && <p className="result"><span className={`s-${MARK[view.entry.status][1]}`} aria-hidden>{MARK[view.entry.status][0]}</span> {result || (view.entry.status === 'stopped' ? 'Stopped.' : 'Done.')}</p>}
            </div>
          );
        })()}

        {view.kind === 'refused' && (
          <div className="trace refused">
            <div><small>{stripWords(view.entry).saidLabel}</small><strong>{stripWords(view.entry).said}</strong></div>
            <div className="wide"><small>Not done</small><strong>{view.entry.text}</strong></div>
          </div>
        )}

        {view.kind === 'ask' && (
          <div className="ask">
            {view.entry.heard && <small>You said “{view.entry.heard}”</small>}
            <p>Which one did you mean?</p>
            <div className="opts">
              {view.entry.choices?.map((c, i) => (
                <button key={c.id} type="button" onClick={() => send({ type: 'choose', logId: view.entry.id, index: i })}><span>{i + 1}</span>{c.label}</button>
              ))}
            </div>
          </div>
        )}

        {view.kind === 'answer' && (
          <div className="answer">
            <small>You asked “{view.entry.heard}”. No buttons were pressed.</small>
            <p>{view.entry.text}</p>
          </div>
        )}
      </div>

      <Earlier entries={earlier} />
    </section>
  );
}
