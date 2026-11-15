// Prints the actions each saved state offers, so eval cases can be written against them.
import { GameClient } from '../../src/server/game.js';
const names = process.argv.slice(2);
const g = await GameClient.start({ romPath: process.env.ROM_PATH ?? 'roms/red.gb', autosave: false });
for (const n of names) {
  await g.load(n);
  await new Promise((r) => setTimeout(r, 300));
  console.log(`\n=== ${n}  mode=${g.state.mode} map=${g.state.map} dialog=${JSON.stringify(g.state.dialog)}`);
  for (const a of g.actions) console.log(`  ${a.id}  | ${a.label}${a.costly ? '  [costly]' : ''}`);
}
await (g as any).close?.();
process.exit(0);
