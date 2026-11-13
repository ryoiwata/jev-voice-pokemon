import { describe, it, expect } from 'vitest';
import { laneView, stripWords, LINGER_MS } from './lane';
import type { LogEntry } from '../../src/server/wire';

let n = 0;
const e = (status: LogEntry['status'], at: number, extra: Partial<LogEntry> = {}): LogEntry =>
  ({ id: String(++n), at, source: 'human', status, text: '', ...(status === 'running' ? {} : { doneAt: at }), ...extra });

describe('laneView', () => {
  it('is idle with an empty log, and again once a finished command is older than 4 s', () => {
    expect(LINGER_MS).toBe(4000);
    expect(laneView([], 0).kind).toBe('idle');
    expect(laneView([e('done', 1000)], 5001).kind).toBe('idle');
  });
  it('shows the strip while running and for 4 s after it finished', () => {
    expect(laneView([e('running', 0)], 60_000)).toMatchObject({ kind: 'strip', live: true });
    expect(laneView([e('done', 1000)], 4999)).toMatchObject({ kind: 'strip', live: false });
    expect(laneView([e('stopped', 1000)], 4999)).toMatchObject({ kind: 'strip', live: false });
  });
  it('the linger counts from when it finished, not from when it started', () => {
    expect(laneView([e('done', 0, { doneAt: 30_000 })], 33_000).kind).toBe('strip');
  });
  it('a new command replaces a lingering one at once', () => {
    const v = laneView([e('done', 1000, { heard: 'old', chose: 'Old' }), e('running', 1500, { heard: 'new', chose: 'New' })], 1600);
    expect(v).toMatchObject({ kind: 'strip', live: true });
    expect((v as any).entry.heard).toBe('new');
    expect((v as any).entry.chose).toBe('New');
  });
  it('asking and answers stay until something newer arrives', () => {
    expect(laneView([e('asking', 0)], 999_999).kind).toBe('ask');
    expect(laneView([e('answer', 0)], 999_999).kind).toBe('answer');
    expect(laneView([e('asking', 0), e('running', 10)], 20).kind).toBe('strip');
  });
  it('a failure shows as refused for 4 s; info entries never take the lane', () => {
    expect(laneView([e('failed', 0)], 100).kind).toBe('refused');
    expect(laneView([e('failed', 0)], 4001).kind).toBe('idle');
    expect(laneView([e('asking', 0), e('info', 10)], 20).kind).toBe('ask');
  });
  it('a failed action that had been chosen still shows as a strip', () => {
    expect(laneView([e('failed', 0, { chose: 'Take the stairs' })], 100).kind).toBe('strip');
  });
});

describe('stripWords', () => {
  it('words the strip by who spoke and who chose', () => {
    expect(stripWords(e('running', 0, { heard: 'go downstairs', chose: 'Take the stairs', sure: 0.957, by: 'jev' })))
      .toEqual({ saidLabel: 'You said', said: '“go downstairs”', choseLabel: 'Jev chose', chose: 'Take the stairs', sure: '96% sure', pressingFor: 'for you' });
    expect(stripWords(e('running', 0, { heard: 'press a', chose: 'Press A', by: 'direct' }))).toMatchObject({ choseLabel: 'Understood directly', sure: null });
    expect(stripWords(e('running', 0, { chose: 'Walk there', by: 'direct' }))).toMatchObject({ saidLabel: 'You', said: 'Clicked the screen', choseLabel: 'Doing' });
    expect(stripWords(e('running', 0, { source: 'agent', chose: 'Open the bag', by: 'direct' }))).toMatchObject({ saidLabel: 'An agent', said: 'Sent an action', choseLabel: 'Doing', pressingFor: 'for an agent' });
    expect(stripWords(e('running', 0, { source: 'agent', heard: 'open the bag', chose: 'Open the bag', sure: 0.9, by: 'jev' }))).toMatchObject({ saidLabel: 'An agent said', said: '“open the bag”' });
    expect(stripWords(e('running', 0, { heard: 'x', chose: 'Y', sure: 0.8, by: 'standin' })).choseLabel).toBe('Stand-in chose');
  });
  it('never claims more than 99% or less than 1%', () => {
    expect(stripWords(e('running', 0, { heard: 'x', chose: 'Y', sure: 0.9999, by: 'jev' })).sure).toBe('99% sure');
    expect(stripWords(e('running', 0, { heard: 'x', chose: 'Y', sure: 0.001, by: 'jev' })).sure).toBe('1% sure');
  });
});
