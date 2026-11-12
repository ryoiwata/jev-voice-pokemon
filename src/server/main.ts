import './env.js';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { GameClient } from './game.js';
import { parseClientMsg, TAG_FRAME, TAG_AUDIO, type LogEntry, type ServerMsg } from './wire.js';
import { Session } from './session.js';
import { Answerer } from '../answer/answerer.js';
import { Interpreter } from '../interpret/interpreter.js';
import { Jev } from '../jev/client.js';
import { StandinJev } from '../jev/standin.js';

const WEB = path.resolve('web/dist');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };

function listSaves(): string[] {
  try { return fs.readdirSync('saves').filter((f) => f.endsWith('.state.json')).map((f) => f.replace(/\.state\.json$/, '')).sort(); }
  catch { return []; }
}

function tagged(tag: number, bytes: Uint8Array): Buffer {
  const out = Buffer.allocUnsafe(1 + bytes.byteLength);
  out[0] = tag;
  out.set(bytes, 1);
  return out;
}

export interface ServerOpts { port: number; fresh?: boolean; load?: string; autosave?: boolean }

export async function startServer(opts: ServerOpts): Promise<{ game: GameClient; session: Session; url: string; close(): Promise<void> }> {
  const resume = opts.load ?? (opts.fresh ? undefined : 'autosave');
  const game = await GameClient.start({ romPath: process.env.ROM_PATH ?? 'roms/red.gb', resume, autosave: opts.autosave });
  game.on('log', (kind: string, msg: string) => { if (kind === 'error') console.error(`[game] ${msg}`); });

  const jev = new Jev({ logFile: opts.autosave === false ? null : undefined });
  const answerer = new Answerer();
  const session = new Session({ game, interpreter: new Interpreter(jev, new StandinJev()), answerer, jev: jev.backend.name === 'gateway' ? 'gateway' : 'standin' });
  const recent: LogEntry[] = [];

  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    const file = path.join(WEB, path.normalize(url === '/' ? 'index.html' : url));
    if (!file.startsWith(WEB) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(url === '/' ? 'The page has not been built yet. Run: npm run build:web' : 'Not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });

  const sockets = new Set<WebSocket>();
  const send = (ws: WebSocket, m: ServerMsg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
  const broadcast = (m: ServerMsg) => { for (const ws of sockets) send(ws, m); };
  const broadcastBin = (buf: Buffer) => { for (const ws of sockets) if (ws.readyState === ws.OPEN && ws.bufferedAmount < 1_000_000) ws.send(buf); };

  game.on('frame', (f: Uint8Array) => { if (sockets.size) broadcastBin(tagged(TAG_FRAME, f)); });
  game.on('audio', (s: Int16Array) => { if (sockets.size) broadcastBin(tagged(TAG_AUDIO, new Uint8Array(s.buffer, s.byteOffset, s.byteLength))); });
  game.on('state', (state) => broadcast({ type: 'state', state }));
  session.on('session', (info) => broadcast({ type: 'session', ...info }));
  session.on('log', (entry: LogEntry) => {
    const i = recent.findIndex((e) => e.id === entry.id);
    if (i >= 0) recent[i] = { ...entry }; else { recent.push({ ...entry }); if (recent.length > 100) recent.shift(); }
    broadcast({ type: 'log', entry });
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on('connection', (ws) => {
    sockets.add(ws);
    send(ws, { type: 'state', state: game.state });
    send(ws, { type: 'saves', names: listSaves() });
    send(ws, { type: 'session', ...session.info() });
    for (const entry of recent) send(ws, { type: 'log', entry });
    ws.on('message', async (data, isBinary) => {
      if (isBinary) return;
      const m = parseClientMsg(String(data));
      if (!m) return;
      try {
        switch (m.type) {
          case 'down': case 'up': case 'tap': session.rawButton(m.type, m.button); break;
          case 'stop': session.stop('human'); break;
          case 'text': await session.handleText(m.text, 'human'); break;
          case 'choose': await session.choose(m.logId, m.index, 'human'); break;
          case 'click': await session.click(m.col, m.row); break;
          case 'set': session.set(m.key, m.value); break;
          case 'save': await game.save(m.name); broadcast({ type: 'saves', names: listSaves() }); break;
          case 'load': await game.load(m.name); break;
        }
      } catch (e) { console.error(`[ws] ${(e as Error).message}`); }
    });
    // a closed or reloaded tab must not leave a direction held down
    ws.on('close', () => { sockets.delete(ws); game.ctl.releaseAll(); });
  });

  await new Promise<void>((resolve) => server.listen(opts.port, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    game, session, url: `http://127.0.0.1:${port}`,
    async close() {
      for (const ws of sockets) ws.terminate();
      await new Promise((r) => server.close(r));
      await game.shutdown();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const s = await startServer({ port: +(opt('port') ?? process.env.PORT ?? 8787), fresh: args.includes('--fresh'), load: opt('load') });
  console.log(`Pokémon Red is running: ${s.url}`);
  let closing = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { if (closing) return; closing = true; await s.close(); process.exit(0); });
}
