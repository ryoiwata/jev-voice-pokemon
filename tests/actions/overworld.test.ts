import { describe, it, expect } from 'vitest';
import { listActions, runAction, tileAction } from '../../src/actions/index.js';
import { hasFixture, boot } from '../helpers/rom.js';
import { detectMode } from '../../src/game/mode.js';

const POSITIONAL = ['door', 'interact', 'go'];

describe.skipIf(!hasFixture('fx-bedroom'))('overworld actions', () => {
  it('lists the stairs and the PC in the bedroom, nearest first, with no strategy text', () => {
    const acts = listActions(boot('fx-bedroom')).filter((a) => POSITIONAL.includes(a.kind) && a.at);
    expect(acts.some((a) => a.id.startsWith('warp:') && /Reds House 1F/i.test(a.label))).toBe(true);
    expect(acts.some((a) => /PC/.test(a.label))).toBe(true);
    const d = acts.map((a) => a.distance!);
    expect(d).toEqual([...d].sort((p, q) => p - q));
    expect(acts.every((a) => !/objective|toward|areas\)|\(\d+,\d+\)/i.test(a.label))).toBe(true);
  });

  it('gives every action a different label', () => {
    const labels = listActions(boot('fx-bedroom')).map((a) => a.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('offers the START menu and no steps-to-nowhere extras', () => {
    const ids = listActions(boot('fx-bedroom')).map((a) => a.id);
    expect(ids).toContain('start');
    expect(ids.some((id) => /grass|explore/.test(id))).toBe(false);
  });

  it('taking the stairs changes the map', () => {
    const ctx = boot('fx-bedroom');
    const id = listActions(ctx).find((a) => a.id.startsWith('warp:'))!.id;
    expect(runAction(ctx, id).status).toBe('done');
    expect(ctx.gs.mapName).toBe('REDS_HOUSE_1F');
  });

  it('using the PC ends in a prompt', () => {
    const ctx = boot('fx-bedroom');
    const id = listActions(ctx).find((a) => /PC/.test(a.label))!.id;
    expect(runAction(ctx, id).status).toBe('prompt');
    expect(ctx.gs.screen().hasTextBox).toBe(true);
  });

  it('opening the menu ends in a prompt listing its entries', () => {
    const ctx = boot('fx-bedroom');
    expect(runAction(ctx, 'start').status).toBe('prompt');
    expect(listActions(ctx).map((a) => a.id)).toEqual(expect.arrayContaining(['menu:SAVE', 'menu:EXIT']));
  });

  it('tileAction maps a click on a thing to its action and bare floor to a tile walk', () => {
    const ctx = boot('fx-bedroom');
    const pc = listActions(ctx).find((a) => /PC/.test(a.label))!;
    expect(tileAction(ctx, pc.at!.x - ctx.gs.x + 4, pc.at!.y - ctx.gs.y + 4)).toBe(pc.id);
    expect(tileAction(ctx, 4, 4)).toBe(`tile:${ctx.gs.x},${ctx.gs.y}`);
  });

  it('walks to a clicked floor tile', () => {
    const ctx = boot('fx-bedroom');
    const stairs = listActions(ctx).find((a) => a.id.startsWith('warp:'))!;
    // a floor tile next to the player that is not the stairs
    const target = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: ctx.gs.x + dx, y: ctx.gs.y + dy }))
      .find((t) => !(t.x === stairs.at!.x && t.y === stairs.at!.y) && runAction(boot('fx-bedroom'), `tile:${t.x},${t.y}`).status === 'done')!;
    expect(target).toBeTruthy();
    expect(runAction(ctx, `tile:${target.x},${target.y}`).status).toBe('done');
    expect([ctx.gs.x, ctx.gs.y]).toEqual([target.x, target.y]);
  });

  it('an unreachable tile fails cleanly', () => {
    const ctx = boot('fx-bedroom'); const f0 = ctx.emu.frames;
    expect(runAction(ctx, 'tile:200,200')).toEqual({ status: 'failed', message: "Can't get there." });
    expect(ctx.emu.frames).toBe(f0);
  });

  it('tileAction is null when the player is not free to walk', () => {
    expect(tileAction(boot('fx-menu'), 4, 4)).toBeNull();
  });
});

import { GameClient } from '../../src/server/game.js';
import { ROM_PATH } from '../helpers/rom.js';

describe.skipIf(!hasFixture('fx-bedroom'))('click-to-go through the game thread', () => {
  it('resolves a click on the player’s own tile and runs it', async () => {
    const g = await GameClient.start({ romPath: ROM_PATH, resume: 'fixtures/fx-bedroom', autosave: false });
    const id = await g.tileAction(4, 4);
    expect(id).toBe(`tile:${g.state.x},${g.state.y}`);
    expect((await g.run(id!)).status).toBe('done');
    await g.shutdown();
  });
});

import { buildGrid } from '../../src/game/world.js';

describe.skipIf(!hasFixture('fx-bedroom'))('walking up to something that cannot be stood on', () => {
  it('goes to the tile in front of it and faces it', () => {
    const probe = boot('fx-bedroom');
    const g = buildGrid(probe.emu, probe.rom, probe.gs);
    // a piece of furniture or wall with open floor directly below it, away from where the player starts
    let spot: { x: number; y: number } | null = null;
    for (let y = 0; y < g.h - 1 && !spot; y++) for (let x = 0; x < g.w; x++) {
      if (!g.walkable(x, y) && g.walkable(x, y + 1) && Math.abs(x - probe.gs.x) + Math.abs(y + 1 - probe.gs.y) > 1) { spot = { x, y }; break; }
    }
    expect(spot).toBeTruthy();
    const ctx = boot('fx-bedroom');
    const r = runAction(ctx, `tile:${spot!.x},${spot!.y}`);
    expect(r.status).toBe('done');
    expect([ctx.gs.x, ctx.gs.y]).toEqual([spot!.x, spot!.y + 1]);
    expect(ctx.gs.facing).toBe('up');
  });
});

describe.skipIf(!hasFixture('fx-bedroom'))('scenery: furniture the game does not treat as a thing', () => {
  it('lists the bed, the TV and the plant in the bedroom', () => {
    const labels = listActions(boot('fx-bedroom')).map((a) => a.label);
    expect(labels).toEqual(expect.arrayContaining(['Go to the bed', 'Go to the TV', 'Go to the plant']));
  });
  it('"go to the bed" walks up beside it and faces it', () => {
    const ctx = boot('fx-bedroom');
    const bed = listActions(ctx).find((a) => a.label === 'Go to the bed')!;
    expect(runAction(ctx, bed.id).status).toBe('done');
    const dx = bed.at!.x - ctx.gs.x, dy = bed.at!.y - ctx.gs.y;
    expect(Math.abs(dx) + Math.abs(dy)).toBe(1);
    expect(ctx.gs.facing).toBe(dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down');
  });
  it('downstairs lists the table and the bookshelf', () => {
    const ctx = boot('fx-bedroom');
    runAction(ctx, listActions(ctx).find((a) => a.id.startsWith('warp:'))!.id);
    const labels = listActions(ctx).map((a) => a.label);
    expect(labels.some((l) => /^Go to the table/.test(l))).toBe(true);
    expect(labels.some((l) => /^Go to the bookshelf/.test(l))).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe.skipIf(!hasFixture('fx-pallet'))('people are described, not just named', () => {
  it('tells the model what kind of person each one is and where they are', () => {
    const acts = listActions(boot('fx-pallet'));
    const fisher = acts.find((a) => a.label.startsWith('Talk to Fisher'))!;
    const girl = acts.find((a) => a.label.startsWith('Talk to Girl'))!;
    expect(fisher.hint).toMatch(/a man/);
    expect(girl.hint).toMatch(/a girl/);
    expect(fisher.hint).toMatch(/steps? away/);
    expect(fisher.hint).toMatch(/left|right|above|below/);
  });
});

describe.skipIf(!hasFixture('fx-pallet'))('the START menu’s entries, said directly', () => {
  it('offers saving and the other entries without opening the menu first', () => {
    const acts = listActions(boot('fx-pallet'));
    expect(acts.find((a) => a.id === 'startmenu:SAVE')).toMatchObject({ label: 'Save the game' });
    expect(acts.map((a) => a.id)).toEqual(expect.arrayContaining(['startmenu:ITEM', 'startmenu:OPTION']));
  });
  it('"save the game" opens the menu, chooses SAVE, and stops at the game’s own "save?" question', () => {
    const ctx = boot('fx-pallet');
    const r = runAction(ctx, 'startmenu:SAVE');
    expect(r.status).toBe('prompt');
    expect(ctx.gs.screen().rows.join(' ')).toMatch(/SAVE/);
    const acts = listActions(ctx);
    expect(acts.map((a) => a.id)).toEqual(expect.arrayContaining(['menu:YES', 'menu:NO']));
    expect(acts.find((a) => a.id === 'menu:YES')!.costly).toBe(true);
  });
  it('the Pokémon list is only offered once there is a Pokémon', () => {
    expect(listActions(boot('fx-pallet')).some((a) => a.id === 'startmenu:POKéMON')).toBe(false);
  });
});

/** Route 1, standing in the tall grass just after running from the wild battle in fx-wild. */
function onRoute1() {
  const ctx = boot('fx-wild');
  for (let i = 0; i < 8 && detectMode(ctx) !== 'overworld'; i++) {
    const acts = listActions(ctx);
    runAction(ctx, (acts.find((a) => a.id === 'run') ?? acts.find((a) => a.id === 'text:next') ?? acts[0]).id);
  }
  return ctx;
}
const onGrass = (ctx: ReturnType<typeof boot>) => buildGrid(ctx.emu, ctx.rom, ctx.gs).grass(ctx.gs.x, ctx.gs.y);

describe.skipIf(!hasFixture('fx-wild'))('terrain: what the player can see but the game does not name', () => {
  it('standing in tall grass, offers leaving it and the other patch in view', () => {
    const ctx = onRoute1();
    expect(detectMode(ctx)).toBe('overworld');
    expect(onGrass(ctx)).toBe(true);
    const acts = listActions(ctx);
    const leave = acts.find((a) => a.id.startsWith('terrain:clear:'))!;
    expect(leave.label).toBe('Leave the tall grass');
    const into = acts.filter((a) => a.id.startsWith('terrain:grass:'));
    // two other patches are on screen (up to the left and up to the right); the one the player stands in is not offered
    expect(into.map((a) => a.label).sort()).toEqual(['Walk into the tall grass to the north-east', 'Walk into the tall grass to the north-west']);
    // plain "the grass" should mean the nearest one, so the model is told which that is
    const nearest = [...into].sort((a, b) => a.distance! - b.distance!)[0];
    expect(nearest.hint).toMatch(/NEAREST tall grass/);
    expect(into.filter((a) => /NEAREST/.test(a.hint!))).toHaveLength(1);
    const g = buildGrid(ctx.emu, ctx.rom, ctx.gs);
    for (const a of into) {
      expect(g.grass(a.at!.x, a.at!.y)).toBe(true);
      expect(a.hint).toMatch(/wild Pokémon/);
      expect(a.hint).toMatch(/above of the player, \d+ steps? away/);
    }
  });

  it('"leave the tall grass" ends on open ground, and "walk into the tall grass" ends in it (or in the battle it started)', () => {
    const ctx = onRoute1();
    const leave = listActions(ctx).find((a) => a.id.startsWith('terrain:clear:'))!;
    expect(runAction(ctx, leave.id).status).toBe('done');
    expect(onGrass(ctx)).toBe(false);
    const acts = listActions(ctx);
    expect(acts.some((a) => a.id.startsWith('terrain:clear:'))).toBe(false);   // nothing to leave now
    const into = acts.filter((a) => a.id.startsWith('terrain:grass:'));
    expect(into.length).toBeGreaterThanOrEqual(1);
    expect(new Set(into.map((a) => a.label)).size).toBe(into.length);          // told apart by direction
    into.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    runAction(ctx, into[0].id);
    expect(detectMode(ctx) === 'battle' || onGrass(ctx)).toBe(true);
  });

  it('only offers terrain that is on the screen', () => {
    const ctx = onRoute1();
    const { x: px, y: py } = ctx.gs;
    for (const a of listActions(ctx).filter((x) => x.id.startsWith('terrain:'))) {
      expect(a.at!.x).toBeGreaterThanOrEqual(px - 4); expect(a.at!.x).toBeLessThanOrEqual(px + 5);
      expect(a.at!.y).toBeGreaterThanOrEqual(py - 4); expect(a.at!.y).toBeLessThanOrEqual(py + 4);
    }
  });
});

describe.skipIf(!hasFixture('fx-bedroom'))('terrain indoors', () => {
  it('a bedroom has no grass or water to offer', () => {
    expect(listActions(boot('fx-bedroom')).some((a) => a.id.startsWith('terrain:'))).toBe(false);
  });
});

describe.skipIf(!hasFixture('fx-pallet'))('terrain: water', () => {
  it('offers the pond once it is on screen, and walks to its edge facing it', () => {
    const ctx = boot('fx-pallet');
    expect(listActions(ctx).some((a) => a.id.startsWith('terrain:water:'))).toBe(false);   // not in view from the start
    expect(runAction(ctx, 'tile:8,12').status).toBe('done');
    const water = listActions(ctx).find((a) => a.id.startsWith('terrain:water:'))!;
    expect(water.label).toBe('Go to the water');
    expect(runAction(ctx, water.id).status).toBe('done');
    const g = buildGrid(ctx.emu, ctx.rom, ctx.gs);
    const [dx, dy] = ({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as Record<string, number[]>)[ctx.gs.facing];
    expect(g.water(ctx.gs.x + dx, ctx.gs.y + dy)).toBe(true);
  });
});

describe.skipIf(!hasFixture('fx-lab'))('going around a person', () => {
  it('offers walking past each person close by, to the far side of them', () => {
    const ctx = boot('fx-lab');
    const past = listActions(ctx).filter((a) => a.id.startsWith('terrain:past:'));
    const rival = past.find((a) => /Rival/.test(a.label))!;
    expect(rival.label).toBe('Go around Rival1');
    expect(rival.hint).toMatch(/without talking/);
    expect(rival.at).toEqual({ x: 3, y: 3 });     // the square beyond the rival, who is at (4,3) with the player at (5,3)
    expect(past.some((a) => /Poké Ball|Pokédex/.test(a.label))).toBe(false);   // only people
  });
  it('"go around the rival" ends on the far side of him without starting a conversation', () => {
    const ctx = boot('fx-lab');
    const rival = listActions(ctx).find((a) => a.id.startsWith('terrain:past:') && /Rival/.test(a.label))!;
    expect(runAction(ctx, rival.id).status).toBe('done');
    expect([ctx.gs.x, ctx.gs.y]).toEqual([3, 3]);
    expect(ctx.gs.screen().hasTextBox).toBe(false);
  });
});
