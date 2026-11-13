import { useState } from 'react';
import type { GameSnapshot } from '../../src/game/snapshot';
import { itemIcon } from './itemIcon';
import { ItemIcon } from './BagIcon';
import { pretty, statusWord, facingWord, BADGE_NAMES } from './words';

/** A picture read from the player's ROM, on a Game Boy-coloured tile. Falls back to a letter if it cannot load. */
function Pic({ src, name, dim }: { src: string; name: string; dim?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div className={`pic ${dim ? 'dim' : ''}`}>
      {failed === src ? <span aria-hidden>{name.slice(0, 1)}</span> : <img key={src} src={src} alt="" onError={() => setFailed(src)} />}
    </div>
  );
}
const monPic = (species: string) => `/pic/mon/${encodeURIComponent(species)}.png`;

function Hp({ hp, max, exact }: { hp: number; max: number; exact: boolean }) {
  const pct = max > 0 ? Math.max(hp > 0 ? 1 : 0, Math.round((hp / max) * 100)) : 0;
  const level = pct > 50 ? '' : pct > 20 ? 'low' : 'crit';
  return (
    <div className="hpline">
      <div className="bar" role="img" aria-label={`${pct}% health`}><i className={level} style={{ width: `${pct}%` }} /></div>
      <span>{exact ? `${hp}/${max}` : `${pct}%`}</span>
    </div>
  );
}

function Foe({ battle }: { battle: NonNullable<GameSnapshot['battle']> }) {
  const e = battle.enemy;
  const status = statusWord(e.status, e.hp);
  return (
    <section className="sec foe" aria-label="Battle">
      <h2>In battle <span>{battle.kind === 'wild' ? 'a wild Pokémon' : 'a trainer’s Pokémon'}</span></h2>
      <div className="row">
        <Pic src={monPic(e.species)} name={e.species} />
        <div className="body">
          <div className="nm">{pretty(e.species)}{status && <span className="tag">{status}</span>}<span className="lv">Lv {e.level}</span></div>
          {/* the game never tells the player an enemy's exact HP, so neither do we */}
          <Hp hp={e.hp} max={e.maxHp} exact={false} />
        </div>
      </div>
    </section>
  );
}

function Party({ state }: { state: GameSnapshot }) {
  return (
    <section className="sec" aria-label="Party">
      <h2>Party <span>{state.party.length} of 6</span></h2>
      {state.party.length === 0 && <p className="empty">No Pokémon yet.</p>}
      {state.party.map((p) => {
        const status = statusWord(p.status, p.hp);
        const out = !!state.battle && state.battle.slot === p.slot;
        return (
          <div className={`mon ${out ? 'out' : ''}`} key={p.slot}>
            <Pic src={monPic(p.species)} name={p.species} dim={p.hp <= 0} />
            <div className="body">
              <div className="nm">
                {p.nickname === p.species ? pretty(p.species) : <>{p.nickname} <small>{pretty(p.species)}</small></>}
                {out && <span className="tag">in battle</span>}
                {status && <span className="tag ill">{status}</span>}
                <span className="lv">Lv {p.level}</span>
              </div>
              <Hp hp={p.hp} max={p.maxHp} exact />
              <ul className="moves">{p.moves.map((m) => <li key={m.name} className={m.pp === 0 ? 'spent' : ''}>{pretty(m.name)} <em>{m.pp}/{m.maxPp}</em></li>)}</ul>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function TrainerCard({ state }: { state: GameSnapshot }) {
  const started = !!state.map;
  const who = [state.playerName, facingWord(state.facing)].filter(Boolean).join(', ');
  return (
    <section className="card" aria-label="Trainer">
      <div className="row">
        <Pic src="/pic/trainer.png" name={state.playerName || 'T'} />
        <div><div className="place">{started ? pretty(state.map) : 'Not started yet'}</div>{started && who && <div className="sub">{who}</div>}</div>
      </div>
      <dl>
        <div><dt>Money</dt><dd>¥{state.money.toLocaleString('en-US')}</dd></div>
        <div><dt>Pokédex</dt><dd>{state.pokedex.seen} seen, {state.pokedex.owned} caught</dd></div>
        <div><dt>Played</dt><dd>{state.playTime}</dd></div>
      </dl>
      <div className="badges">
        {state.badgeList.map((won, i) => <i key={i} className={won ? 'won' : ''} {...(won ? { title: `${BADGE_NAMES[i]} Badge`, role: 'img', 'aria-label': `${BADGE_NAMES[i]} Badge` } : { 'aria-hidden': true })} />)}
      </div>
      <div className="cap">{state.badges} of 8 badges</div>
    </section>
  );
}

function Bag({ state }: { state: GameSnapshot }) {
  const n = state.bag.length;
  return (
    <section className="sec" aria-label="Bag">
      <h2>Bag <span>{n === 0 ? 'empty' : `${n} ${n === 1 ? 'kind' : 'kinds'} of item`}</span></h2>
      {n === 0 ? <p className="empty">The bag is empty.</p>
        : <ul className="bag">{state.bag.map((i) => <li key={i.name}><ItemIcon kind={itemIcon(i.name)} />{pretty(i.name)}<em>×{i.qty}</em></li>)}</ul>}
    </section>
  );
}

/** The game's facts beside the console: the battle (when there is one), the party, the trainer, the bag. */
export function Sidebar({ state }: { state: GameSnapshot }) {
  return (
    <aside>
      {state.battle && <Foe battle={state.battle} />}
      <Party state={state} />
      <TrainerCard state={state} />
      <Bag state={state} />
    </aside>
  );
}
