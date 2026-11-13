import { describe, it, expect } from 'vitest';
import { once } from 'node:events';
import http from 'node:http';
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
      if (isBinary) { if (d[0] === 1 && d[1] === 0 && d.length === 2 + 160 * 144 * 4) frames++; }
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

  it('serves pictures as PNGs, 404s unknown names, and keeps other sites out', async () => {
    const { url, close } = await startServer({ port: 0, fresh: true, autosave: false });
    const ok = await fetch(`${url}/pic/mon/${encodeURIComponent('RATTATA')}.png`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect(ok.headers.get('cache-control')).toBe('max-age=86400');
    expect(Buffer.from(await ok.arrayBuffer()).subarray(1, 4).toString()).toBe('PNG');
    expect((await fetch(`${url}/pic/mon/${encodeURIComponent("FARFETCH'D")}.png`)).status).toBe(200);
    expect((await fetch(`${url}/pic/mon/${encodeURIComponent('NIDORAN♂')}.png`)).status).toBe(200);
    expect((await fetch(`${url}/pic/trainer.png`)).status).toBe(200);
    expect((await fetch(`${url}/pic/mon/NOPE.png`)).status).toBe(404);
    expect((await fetch(`${url}/pic/mon/..%2F..%2Fpackage.json.png`)).status).toBe(404);
    expect((await fetch(`${url}/pic/mon/%E0%A4%A.png`)).status).toBe(404); // a broken escape is not a crash
    const evil = await new Promise<number>((resolve, reject) => {
      const u = new URL(url);
      http.get({ host: u.hostname, port: u.port, path: '/pic/trainer.png', headers: { host: 'evil.example' } }, (r) => { r.resume(); resolve(r.statusCode!); }).on('error', reject);
    });
    expect(evil).toBe(403);
    await close();
  });
});
