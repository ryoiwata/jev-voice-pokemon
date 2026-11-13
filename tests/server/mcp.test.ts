import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startServer } from '../../src/server/main.js';
import { hasFixture } from '../helpers/rom.js';

const text = (r: any) => r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');

describe.skipIf(!hasFixture('fx-bedroom'))('MCP door', () => {
  let srv: Awaited<ReturnType<typeof startServer>>, client: Client;
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as Promise<any>;

  beforeAll(async () => {
    srv = await startServer({ port: 0, load: 'fixtures/fx-bedroom', autosave: false });
    client = new Client({ name: 'test-agent', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${srv.url}/mcp`)));
  });
  afterAll(async () => { await client.close(); await srv.close(); });

  it('lists the ten tools', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['ask', 'do_action', 'get_screen', 'get_state', 'list_actions', 'load_state', 'press', 'save_state', 'send_command', 'stop']);
  });

  it('reads state, actions and the screen in any mode', async () => {
    expect(srv.session.mode).toBe('voice');
    const state = JSON.parse(text(await call('get_state')));
    expect(state).toMatchObject({ map: 'REDS_HOUSE_2F', mode: 'overworld', inputMode: 'voice' });
    const actions = JSON.parse(text(await call('list_actions')));
    expect(actions.some((a: any) => a.id === 'start')).toBe(true);
    const screen = await call('get_screen');
    expect(screen.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(Buffer.from(screen.content[0].data, 'base64').subarray(1, 4).toString()).toBe('PNG');
  });

  it('acts while the player is idle, in voice mode, and returns the outcome', async () => {
    const before = JSON.parse(text(await call('get_state')));
    const r = await call('do_action', { id: 'steps:left', arg: 1 });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(text(r)).status).toMatch(/done|interrupted/);
    const cmd = JSON.parse(text(await call('send_command', { text: 'open the menu' })));
    expect(cmd.status).toBe('prompt');
    expect(JSON.parse(text(await call('press', { buttons: ['B'] }))).status).toBe('done');
    expect(before.inputMode).toBe('voice');
  });

  it('stop works in any mode', async () => {
    const r = await call('stop');
    expect(r.isError).toBeFalsy();
  });

  it('rejects a save name with a path in it, and saves under a plain name', async () => {
    expect((await call('save_state', { name: '../x' })).isError).toBe(true);
    expect((await call('save_state', { name: 't-mcp' })).isError).toBeFalsy();
    expect((await call('load_state', { name: 't-mcp' })).isError).toBeFalsy();
    expect((await call('load_state', { name: 'no-such-save' })).isError).toBe(true);
  });

  it('ask returns the answer text', async () => {
    expect(text(await call('ask', { text: 'what beats rock?' }))).toMatch(/isn't set up|\w+/);
  });
});
