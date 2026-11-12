import { describe, it, expect } from 'vitest';
import { nextStart } from './audio.js';

describe('nextStart', () => {
  it('restarts with a 50 ms lead after an underrun', () => { expect(nextStart(10, 9)).toBeCloseTo(10.05); });
  it('continues exactly where the last chunk ends', () => { expect(nextStart(10, 10.2)).toBeCloseTo(10.2); });
  it('drops a chunk when more than 0.4 s is already queued', () => { expect(nextStart(10, 10.5)).toBeNull(); });
});
