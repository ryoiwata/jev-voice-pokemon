// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { keysPlayGame } from './keys';

const el = (html: string) => { document.body.innerHTML = html; return document.body.querySelector('[data-t]')!; };

describe('keysPlayGame: when a key press is for the game rather than the page', () => {
  it('plays from the page itself and from the console', () => {
    expect(keysPlayGame(document.body)).toBe(true);
    expect(keysPlayGame(el('<div class="gba" tabindex="0" data-t></div>'))).toBe(true);
    expect(keysPlayGame(null)).toBe(true);
  });
  it('never while typing', () => {
    expect(keysPlayGame(el('<input data-t>'))).toBe(false);
    expect(keysPlayGame(el('<textarea data-t></textarea>'))).toBe(false);
    expect(keysPlayGame(el('<select data-t></select>'))).toBe(false);
  });
  it('never while a page control has the focus, so Enter presses that control and not START', () => {
    expect(keysPlayGame(el('<button data-t>Settings</button>'))).toBe(false);
    expect(keysPlayGame(el('<button><span data-t>Stop</span></button>'))).toBe(false);
    expect(keysPlayGame(el('<a href="#" data-t>x</a>'))).toBe(false);
    expect(keysPlayGame(el('<div role="radiogroup"><span role="radio" tabindex="0" data-t></span></div>'))).toBe(false);
  });
});
