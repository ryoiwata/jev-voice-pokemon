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

  it('sends an urgent phrase at once, without waiting for the delay', () => {
    const send = vi.fn(); const a = new AutoSender(send, (t) => /stop$/.test(t));
    a.update('stop', 2000, true);
    expect(send).toHaveBeenCalledExactlyOnceWith('stop');
    vi.advanceTimersByTime(5000); expect(send).toHaveBeenCalledOnce();
  });
  it('an urgent phrase overtakes a command still waiting to be sent', () => {
    const send = vi.fn(); const a = new AutoSender(send, (t) => /stop$/.test(t));
    a.update('walk to the door', 800, true);
    vi.advanceTimersByTime(300);
    a.update('walk to the door stop', 800, true);
    expect(send).toHaveBeenCalledExactlyOnceWith('walk to the door stop');
    vi.advanceTimersByTime(5000); expect(send).toHaveBeenCalledOnce();
  });
  it('when sending by itself is off (Text mode), nothing is sent without Enter, urgent or not', () => {
    const send = vi.fn(); const a = new AutoSender(send, (t) => t === 'stop');
    a.update('stop', 800, false);
    vi.advanceTimersByTime(5000); expect(send).not.toHaveBeenCalled();
  });
});
