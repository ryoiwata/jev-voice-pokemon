// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { Console } from './Console';
import { PressTracker } from './pressed';
import type { Connection } from './ws';

beforeAll(() => {
  // jsdom has no canvas or pointer capture
  HTMLCanvasElement.prototype.getContext = (() => ({ createImageData: () => ({ data: new Uint8ClampedArray(160 * 144 * 4) }), putImageData: () => {} })) as any;
  HTMLElement.prototype.setPointerCapture = () => {};
});

afterEach(cleanup);

const conn = (connected = true) => ({ connected, onFrame: { current: null }, onAudio: { current: null }, onLog: { current: null } }) as unknown as Connection;

describe('Console', () => {
  it('keeps the same button elements when the page redraws, so a held button is not dropped', () => {
    const tracker = new PressTracker();
    const props = { tracker, down: vi.fn(), up: vi.fn(), onTile: vi.fn() };
    const { getByLabelText, rerender } = render(<Console conn={conn()} {...props} />);
    const before = getByLabelText('Up');
    rerender(<Console conn={conn()} {...props} />);
    expect(getByLabelText('Up')).toBe(before);
  });

  it('releases a held button when the browser takes the pointer away', () => {
    const tracker = new PressTracker();
    const down = vi.fn(), up = vi.fn();
    const { getByLabelText } = render(<Console conn={conn()} tracker={tracker} down={down} up={up} onTile={vi.fn()} />);
    const a = getByLabelText('A');
    fireEvent.pointerDown(a, { pointerId: 1 });
    expect(down).toHaveBeenCalledWith('A');
    expect(tracker.shown(0)).toEqual(['A']);
    fireEvent.lostPointerCapture(a, { pointerId: 1 });
    expect(up).toHaveBeenCalledWith('A');
    expect(tracker.shown(1000)).toEqual([]);
  });

  it('sends one release per press, however the press ends', () => {
    const up = vi.fn();
    const { getByLabelText } = render(<Console conn={conn()} tracker={new PressTracker()} down={vi.fn()} up={up} onTile={vi.fn()} />);
    const b = getByLabelText('B');
    fireEvent.pointerDown(b, { pointerId: 1 });
    fireEvent.pointerUp(b, { pointerId: 1 });
    fireEvent.lostPointerCapture(b, { pointerId: 1 });
    expect(up).toHaveBeenCalledTimes(1);
  });

  it('says it is reconnecting when the connection is down', () => {
    const { getByRole } = render(<Console conn={conn(false)} tracker={new PressTracker()} down={vi.fn()} up={vi.fn()} onTile={vi.fn()} />);
    expect(getByRole('status').textContent).toBe('Reconnecting…');
  });
});
