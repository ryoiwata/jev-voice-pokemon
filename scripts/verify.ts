// Boots the game from a save fixture and drives it through the MCP door, like an agent would.
// Never touches the autosave or logs/jev-calls.jsonl. Uses the free stand-in Jev unless --live.
//
//   npx tsx scripts/verify.ts --fixture fx-pallet "say:walk to the poke ball" state shot
//   npx tsx scripts/verify.ts --fixture fx-battle actions "do:run" state
//   npx tsx scripts/verify.ts --fixture fx-bedroom --keep      # leave it running to look at in a browser
//
// Steps run in order: state | actions | shot | say:<command> | press:<A,B,...> | do:<id>[:<arg>] | ask:<question>
// Screenshots go to logs/verify/. Exits 1 if any step returns an error.
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const fixture = opt('fixture') ?? 'fx-bedroom';
const steps = args.filter((a, i) => !a.startsWith('--') && !['--fixture', '--port'].includes(args[i - 1] ?? ''));

if (!flag('live')) { process.env.JEV_MODE = 'mock'; process.env.ANTHROPIC_API_KEY = ''; }
if (!fs.existsSync(`saves/fixtures/${fixture}.state.json`)) {
  const have = fs.existsSync('saves/fixtures') ? fs.readdirSync('saves/fixtures').map((f) => f.replace('.state.json', '')).join(', ') : 'none';
  console.error(`No fixture "${fixture}". Have: ${have}. Build them with: npx tsx scripts/make-fixtures.ts`);
  process.exit(1);
}

const { startServer } = await import('../src/server/main.js');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

const srv = await startServer({ port: +(opt('port') ?? 0), load: `fixtures/${fixture}`, autosave: false });
// The action list arrives from the game thread shortly after loading; list_actions is [] until then.
if (!srv.game.actions.length) await new Promise((r) => { const t = setTimeout(r, 5000); srv.game.once('actions', () => { clearTimeout(t); r(null); }); });
const client = new Client({ name: 'verify', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(`${srv.url}/mcp`)));
console.log(`# ${srv.url}  fixture=${fixture}  jev=${flag('live') ? 'live' : 'mock'}`);

const text = (r: any) => r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
const call = (name: string, a: Record<string, unknown> = {}) => client.callTool({ name, arguments: a }) as Promise<any>;
let failed = false, shots = 0;

for (const step of steps.length ? steps : ['state', 'actions']) {
  const [kind, ...rest] = step.split(':');
  const val = rest.join(':');
  let r: any;
  if (kind === 'state') r = await call('get_state');
  else if (kind === 'actions') r = await call('list_actions');
  else if (kind === 'say') r = await call('send_command', { text: val });
  else if (kind === 'ask') r = await call('ask', { text: val });
  else if (kind === 'press') r = await call('press', { buttons: val.split(',') });
  else if (kind === 'do') { const [id, arg] = [rest.slice(0, 2).join(':'), rest[2]]; r = await call('do_action', arg === undefined ? { id } : { id, arg: isNaN(+arg) ? arg : +arg }); }
  else if (kind === 'shot') {
    r = await call('get_screen');
    fs.mkdirSync('logs/verify', { recursive: true });
    const file = `logs/verify/${fixture}-${++shots}.png`;
    fs.writeFileSync(file, Buffer.from(r.content[0].data, 'base64'));
    console.log(`\n## shot -> ${file}`);
    continue;
  } else { console.error(`Unknown step "${step}"`); failed = true; continue; }
  let status: string | undefined;
  try { status = JSON.parse(text(r)).status; } catch {}
  const bad = r.isError || status === 'failed';
  if (bad) failed = true;
  console.log(`\n## ${step}${bad ? '  [FAILED]' : ''}\n${text(r)}`);
}

if (flag('keep')) {
  console.log(`\nStill running at ${srv.url} (Ctrl+C to stop). Run "npm run build:web" first if the page is blank.`);
  process.on('SIGINT', async () => { await client.close(); await srv.close(); process.exit(failed ? 1 : 0); });
} else {
  await client.close();
  await srv.close();
  process.exit(failed ? 1 : 0);
}
