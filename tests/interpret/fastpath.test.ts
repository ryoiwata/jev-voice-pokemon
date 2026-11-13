import { describe, it, expect } from 'vitest';
import { fastPath } from '../../src/interpret/fastpath.js';

const has = (id: string) => ['steps:left', 'steps:up', 'text:next', 'name'].includes(id);

describe('fastPath', () => {
  it('recognises stop in its forms', () => {
    for (const t of ['Stop.', 'stop', 'STOP!', 'halt', 'cancel']) expect(fastPath(t, has, false)).toEqual({ kind: 'stop' });
  });
  it('turns directions into steps when the player can walk, with a count', () => {
    expect(fastPath('left three', has, false)).toEqual({ kind: 'run', id: 'steps:left', arg: 3 });
    expect(fastPath('walk up 2 steps', has, false)).toEqual({ kind: 'run', id: 'steps:up', arg: 2 });
    expect(fastPath('left', has, false)).toEqual({ kind: 'run', id: 'steps:left', arg: 1 });
  });
  it('turns directions into button presses when steps are not on offer', () => {
    expect(fastPath('down', has, false)).toEqual({ kind: 'run', id: 'press:DOWN' });
    expect(fastPath('up', () => false, false)).toEqual({ kind: 'run', id: 'press:UP' });
  });
  it('recognises buttons', () => {
    expect(fastPath('press A', has, false)).toEqual({ kind: 'run', id: 'press:A' });
    expect(fastPath('b', has, false)).toEqual({ kind: 'run', id: 'press:B' });
    expect(fastPath('Start.', has, false)).toEqual({ kind: 'run', id: 'press:START' });
  });
  it('continues text only when there is text to continue', () => {
    expect(fastPath('next', has, false)).toEqual({ kind: 'run', id: 'text:next' });
    expect(fastPath('okay', () => false, false)).toBeNull();
  });
  it('types a name on a naming screen', () => {
    expect(fastPath('name him Sparky', has, false)).toEqual({ kind: 'run', id: 'name', arg: { text: 'Sparky' } });
    expect(fastPath('call it Rex.', has, false)).toEqual({ kind: 'run', id: 'name', arg: { text: 'Rex' } });
    expect(fastPath('name him Sparky', () => false, false)).toBeNull();
  });
  it('switches modes and settings', () => {
    expect(fastPath('text mode', has, false)).toEqual({ kind: 'set', key: 'mode', value: 'text' });
    expect(fastPath('agent mode', has, false)).toBeNull();
    expect(fastPath('controls mode', has, false)).toBeNull();
    expect(fastPath('Voice mode.', has, false)).toEqual({ kind: 'set', key: 'mode', value: 'voice' });
    expect(fastPath('auto advance off', has, false)).toEqual({ kind: 'set', key: 'autoAdvance', value: false });
    expect(fastPath('save', has, false)).toEqual({ kind: 'save' });
    expect(fastPath('load', has, false)).toEqual({ kind: 'load' });
  });
  it('answers a pending question by number, and only then', () => {
    expect(fastPath('the second one', has, true)).toEqual({ kind: 'pick', index: 1 });
    expect(fastPath('1', has, true)).toEqual({ kind: 'pick', index: 0 });
    expect(fastPath('two', has, false)).toBeNull();
  });
  it('leaves everything else to the interpreter', () => {
    expect(fastPath('walk to the poke ball', has, false)).toBeNull();
    expect(fastPath('use start menu', has, false)).toBeNull();
    expect(fastPath('', has, false)).toBeNull();
  });
});

describe('fastPath: movement however it is phrased', () => {
  const has = (id: string) => id.startsWith('steps:');
  it.each([
    ['Move to the right', 'steps:right', 1], ['go to the left', 'steps:left', 1], ['walk up three steps', 'steps:up', 3],
    ['move right 2', 'steps:right', 2], ['step down', 'steps:down', 1], ['go north', 'steps:up', 1], ['walk south two', 'steps:down', 2],
    ['head east', 'steps:right', 1], ['move two steps to the left', 'steps:left', 2], ['take 3 steps up', 'steps:up', 3],
    ['move one step to the right', 'steps:right', 1], ['go west 4 times', 'steps:left', 4],
  ])('"%s"', (said, id, n) => { expect(fastPath(said, has, false)).toEqual({ kind: 'run', id, arg: n }); });
  it('does not mistake other sentences with a direction word for movement', () => {
    expect(fastPath('talk to the youngster to the north', has, false)).toBeNull();
    expect(fastPath('use the item on the right', has, false)).toBeNull();
  });
});
