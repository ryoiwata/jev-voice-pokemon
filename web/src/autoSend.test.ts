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

  describe('while the voice is talking', () => {
    const stop = (t: string) => /stop/.test(t);
    it('throws away dictation that lands while the voice is talking', () => {
      const sent: string[] = [], dropped: string[] = [];
      const a = new AutoSender((t) => sent.push(t), stop, () => true, (t) => dropped.push(t));
      a.update('go north', 300, true); vi.advanceTimersByTime(300);
      expect(sent).toEqual([]);
      expect(dropped).toEqual(['go north']);
    });
    it('still sends a dictated stop at once', () => {
      const sent: string[] = [];
      const a = new AutoSender((t) => sent.push(t), stop, () => true, () => {});
      a.update('stop', 300, true);
      expect(sent).toEqual(['stop']);
    });
    it('decides when the delay is up, so text from the last moments of the voice is dropped and later text is sent', () => {
      let talking = true; const sent: string[] = [], dropped: string[] = [];
      const a = new AutoSender((t) => sent.push(t), stop, () => talking, (t) => dropped.push(t));
      a.update('go north', 300, true); vi.advanceTimersByTime(300);
      talking = false;
      a.update('go south', 300, true); vi.advanceTimersByTime(300);
      expect(dropped).toEqual(['go north']);
      expect(sent).toEqual(['go south']);
    });
  });
});
