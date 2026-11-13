// What the area under the command box shows: the newest thing that happened, in the right form.
import type { LogEntry } from '../../src/server/wire';

/** How long a finished command stays on show. */
export const LINGER_MS = 4000;

export type LaneView =
  | { kind: 'idle' }
  | { kind: 'strip'; entry: LogEntry; live: boolean }
  | { kind: 'ask'; entry: LogEntry }
  | { kind: 'answer'; entry: LogEntry }
  | { kind: 'refused'; entry: LogEntry };

/** Which view to show, from the log (oldest first) and the time. Passing notes ('info') never take the lane. */
export function laneView(log: LogEntry[], now: number): LaneView {
  let entry: LogEntry | undefined;
  for (let i = log.length - 1; i >= 0 && !entry; i--) if (log[i].status !== 'info') entry = log[i];
  if (!entry) return { kind: 'idle' };
  if (entry.status === 'running') return { kind: 'strip', entry, live: true };
  if (entry.status === 'asking') return { kind: 'ask', entry };
  if (entry.status === 'answer') return { kind: 'answer', entry };
  if (now - (entry.doneAt ?? entry.at) > LINGER_MS) return { kind: 'idle' };
  // a command that never got as far as an action shows its reason; anything that ran shows its steps
  return entry.status === 'failed' && !entry.chose ? { kind: 'refused', entry } : { kind: 'strip', entry, live: false };
}

export interface StripWords { saidLabel: string; said: string; choseLabel: string; chose: string; sure: string | null; pressingFor: string }

/** The words for the strip's three steps. */
export function stripWords(e: LogEntry): StripWords {
  const agent = e.source === 'agent';
  const spoken = !!e.heard;
  const saidLabel = spoken ? (agent ? 'An agent said' : 'You said') : agent ? 'An agent' : 'You';
  const said = spoken ? `“${e.heard}”` : agent ? 'Sent an action' : 'Clicked the screen';
  const choseLabel = e.by === 'jev' ? 'Jev chose' : e.by === 'standin' ? 'Stand-in chose' : spoken ? 'Understood directly' : 'Doing';
  const sure = e.sure === undefined || e.by === 'direct' ? null : `${Math.min(99, Math.max(1, Math.round(e.sure * 100)))}% sure`;
  return { saidLabel, said, choseLabel, chose: e.chose ?? '', sure, pressingFor: agent ? 'for an agent' : 'for you' };
}
