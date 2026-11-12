import { describe, it, expect } from 'vitest';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { startServer } from '../../src/server/main.js';
import { hasRom } from '../helpers/rom.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!hasRom)('server', () => {
  it('releases held buttons when the socket closes', async () => {
    const { game, url, close } = await startServer({ port: 0, fresh: true, autosave: false });
    const ws = new WebSocket(url.replace('http', 'ws') + '/ws');
    await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'down', button: 'LEFT' }));
    await sleep(150);
    expect(game.ctl.heldButtons()).toEqual(['LEFT']);
    ws.close();
    await sleep(150);
    expect(game.ctl.heldButtons()).toEqual([]);
    await close();
  });

  it('sends the game state and video frames to a new connection, and ignores malformed messages', async () => {
    const { url, close } = await startServer({ port: 0, fresh: true, autosave: false });
    const ws = new WebSocket(url.replace('http', 'ws') + '/ws');
    let state: any = null, frames = 0;
    ws.on('message', (d: Buffer, isBinary: boolean) => {
      if (isBinary) { if (d[0] === 1 && d.length === 1 + 160 * 144 * 4) frames++; }
      else { const m = JSON.parse(String(d)); if (m.type === 'state') state = m.state; }
    });
    await once(ws, 'open');
    ws.send('garbage'); ws.send('{"type":"down","button":"TURBO"}');
    await sleep(500);
    expect(state?.mode).toBe('boot');
    expect(frames).toBeGreaterThan(5);
    ws.close();
    await close();
  });
});
