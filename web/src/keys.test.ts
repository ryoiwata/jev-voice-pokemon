import { describe, it, expect } from 'vitest';
import { DEFAULT_KEYMAP, buttonFor } from './keys.js';

describe('buttonFor', () => {
  it('maps the default keys, ignoring letter case', () => {
    expect(buttonFor({ key: 'Z' }, DEFAULT_KEYMAP)).toBe('A');
    expect(buttonFor({ key: 'x' }, DEFAULT_KEYMAP)).toBe('B');
    expect(buttonFor({ key: 'ArrowLeft' }, DEFAULT_KEYMAP)).toBe('LEFT');
    expect(buttonFor({ key: 'Enter' }, DEFAULT_KEYMAP)).toBe('START');
    expect(buttonFor({ key: 'Shift' }, DEFAULT_KEYMAP)).toBe('SELECT');
  });
  it('returns null for unmapped keys', () => {
    expect(buttonFor({ key: 'q' }, DEFAULT_KEYMAP)).toBeNull();
  });
});
