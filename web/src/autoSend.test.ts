import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoSender } from './autoSend.js';

describe('AutoSender', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends once after the text has been stable for the delay', () => {
    const send = vi.fn(); const a = new AutoSender(send);
    a.update('walk', 800, true);
    vi.advanceTimersByTime(799); expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(send).toHaveBeenCalledExactlyOnceWith('walk');
    vi.advanceTimersByTime(5000); expect(send).toHaveBeenCalledOnce();
  });
  it('restarts the clock when the text changes', () => {
    const send = vi.fn(); const a = new AutoSender(send);
    a.update('walk', 800, true);
    vi.advanceTimersByTime(600);
    a.update('walk to the ball', 800, true);
    vi.advanceTimersByTime(600); expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200); expect(send).toHaveBeenCalledExactlyOnceWith('walk to the ball');
  });
  it('never sends whitespace', () => {
    const send = vi.fn(); const a = new AutoSender(send);
    a.update('   ', 800, true);
    vi.advanceTimersByTime(5000); expect(send).not.toHaveBeenCalled();
  });
  it('does nothing when switched off, and cancels a send already on its way', () => {
    const send = vi.fn(); const a = new AutoSender(send);
    a.update('walk', 800, false);
    vi.advanceTimersByTime(5000); expect(send).not.toHaveBeenCalled();
    a.update('walk', 800, true); vi.advanceTimersByTime(400);
    a.update('walk', 800, false); vi.advanceTimersByTime(5000);
    expect(send).not.toHaveBeenCalled();
  });
  it('a re-render with the same text does not restart the clock', () => {
    const send = vi.fn(); const a = new AutoSender(send);
    a.update('walk', 800, true); vi.advanceTimersByTime(500);
    a.update('walk', 800, true); vi.advanceTimersByTime(300);
    expect(send).toHaveBeenCalledOnce();
  });
});
