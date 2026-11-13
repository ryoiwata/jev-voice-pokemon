import { describe, it, expect } from 'vitest';
import { PressTracker, MIN_SHOW_MS, TRAIL_MAX } from './pressed';
import { buttonMask } from '../../src/server/wire';

describe('PressTracker', () => {
  it('shows a one-frame tap for at least 90 ms', () => {
    const t = new PressTracker();
    t.frame(buttonMask(['A']), 0); t.frame(0, 16);
    expect(MIN_SHOW_MS).toBe(90);
    expect(t.shown(50)).toEqual(['A']);
    expect(t.shown(16 + 90)).toEqual([]);
  });
  it('a held button shows for as long as frames say it is down', () => {
    const t = new PressTracker();
    t.frame(buttonMask(['UP']), 0); t.frame(buttonMask(['UP']), 1000);
    expect(t.shown(1000)).toEqual(['UP']);
  });
  it('a locally held button stays shown while frames say it is up, without flicker', () => {
    const t = new PressTracker();
    t.local('LEFT', true); t.frame(0, 0); t.frame(0, 500);
    expect(t.shown(500)).toEqual(['LEFT']);
    t.local('LEFT', false);
    expect(t.shown(500)).toEqual([]);
  });
  it('the trail records each new press once, in order, and keeps the newest twelve', () => {
    const t = new PressTracker();
    t.frame(buttonMask(['UP']), 0); t.frame(buttonMask(['UP']), 16); t.frame(0, 32); t.frame(buttonMask(['UP']), 48); t.frame(buttonMask(['A']), 64);
    expect(t.trail()).toEqual(['UP', 'UP', 'A']);
    for (let i = 0; i < 20; i++) { t.frame(buttonMask(['B']), 100 + i * 32); t.frame(0, 116 + i * 32); }
    expect(TRAIL_MAX).toBe(12);
    expect(t.trail()).toHaveLength(12);
    expect(t.trail().at(-1)).toBe('B');
    t.clearTrail();
    expect(t.trail()).toEqual([]);
  });
  it('local presses are not part of the trail: it shows what the game was told', () => {
    const t = new PressTracker();
    t.local('A', true); t.local('A', false);
    expect(t.trail()).toEqual([]);
  });
});
