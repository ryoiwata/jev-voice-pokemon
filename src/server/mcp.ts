import type http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { GameClient } from './game.js';
import type { Session, Outcome } from './session.js';
import { BUTTONS, SAVE_NAME } from './wire.js';

type Deps = { session: Session; game: GameClient };
type Result = { content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]; isError?: boolean };

const json = (v: unknown): Result => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
const error = (message: string): Result => ({ content: [{ type: 'text', text: message }], isError: true });
/** What happened, as the agent should see it. A refusal is an error carrying the session's own words. */
const outcome = (o: Outcome): Result => (o.status === 'refused' ? error(o.message) : json(o));

const button = z.enum(BUTTONS as [string, ...string[]]);
const saveName = z.string().regex(SAVE_NAME, 'Use letters, digits, dashes and underscores only (up to 40).');

/** The tools an outside AI agent gets. Reading always works. Acting is refused while the player is doing something or has just pressed stop. */
function build({ session, game }: Deps): McpServer {
  const mcp = new McpServer({ name: 'jev-voice-pokemon', version: '1.0.0' });
  const A = 'Refused while the player is doing something or has just pressed stop.';

  mcp.registerTool('get_state', { description: 'The game right now: location, party, bag, battle, text on screen, what is running, and the input mode.' },
    async () => json({ ...game.state, inputMode: session.mode }));
  mcp.registerTool('get_screen', { description: 'The current game screen as a PNG image.' },
    async () => ({ content: [{ type: 'image' as const, data: (await game.screenPng()).toString('base64'), mimeType: 'image/png' }] }));
  mcp.registerTool('list_actions', { description: 'Everything that can be done in the game right now. Each has an id to pass to do_action, a label, and for things on the map a position and walking distance.' },
    async () => json(game.actions));
  mcp.registerTool('do_action', { description: `Carry out one action from list_actions and wait for it to finish. "steps:<dir>" takes arg = number of steps; "name" takes arg = {text}. ${A}`,
    inputSchema: { id: z.string().max(80), arg: z.unknown().optional() } },
    async ({ id, arg }) => outcome(await session.runAction(id, 'agent', arg)));
  mcp.registerTool('send_command', { description: `Send a command in plain words, exactly as the player would say it ("walk to the poke ball", "use ember"). ${A}`,
    inputSchema: { text: z.string().max(500) } },
    async ({ text }) => outcome(await session.handleText(text, 'agent')));
  mcp.registerTool('ask', { description: 'Ask a question about the game in progress. Returns text; presses nothing.', inputSchema: { text: z.string().max(500) } },
    async ({ text }) => ({ content: [{ type: 'text' as const, text: await session.ask(text) }] }));
  mcp.registerTool('press', { description: `Tap Game Boy buttons in order (A, B, START, SELECT, UP, DOWN, LEFT, RIGHT). ${A}`, inputSchema: { buttons: z.array(button).min(1).max(20) } },
    async ({ buttons }) => outcome(await session.press(buttons as any, 'agent')));
  mcp.registerTool('stop', { description: 'Stop whatever action is running. Always allowed.' },
    async () => { session.stop('agent'); return json({ status: 'stopped', message: 'Stopped.' }); });
  mcp.registerTool('save_state', { description: `Save the game under a name. ${A}`, inputSchema: { name: saveName } },
    async ({ name }) => outcome(await session.saveState(name, 'agent')));
  mcp.registerTool('load_state', { description: `Load a named save, replacing the game in progress. ${A}`, inputSchema: { name: saveName } },
    async ({ name }) => { const o = await session.loadState(name, 'agent'); return o.status === 'failed' ? error(o.message) : outcome(o); });
  return mcp;
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 1_000_000) throw new Error('too large'); chunks.push(c as Buffer); }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : undefined;
}

/** Serve one MCP request at /mcp (streamable HTTP, stateless: a fresh server per request). */
export async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse, deps: Deps): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
    return;
  }
  let body: unknown;
  try { body = await readBody(req); } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
    return;
  }
  const mcp = build(deps);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { void transport.close(); void mcp.close(); });
  await mcp.connect(transport);
  await transport.handleRequest(req, res, body);
}
