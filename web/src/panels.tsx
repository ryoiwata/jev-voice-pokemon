import type { GameSnapshot } from '../../src/game/snapshot';

const pretty = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(\d+)f\b/gi, '$1F');

function HpBar({ hp, max }: { hp: number; max: number }) {
  const pct = max > 0 ? Math.round((hp / max) * 100) : 0;
  const level = pct > 50 ? 'ok' : pct > 20 ? 'low' : 'crit';
  return <span className="hp" role="img" aria-label={`${pct}% health`}><i className={level} style={{ width: `${pct}%` }} /></span>;
}

export function PartyPanel({ state }: { state: GameSnapshot }) {
  return (
    <section className="panel">
      <h2>Party <span>{state.party.length} / 6</span></h2>
      {state.party.length === 0 && <p className="dim">No Pokémon yet.</p>}
      {state.party.map((p) => (
        <div className="mon" key={p.slot}>
          <div className="mon-top">
            <b>{p.nickname}</b>
            <span className="dim">{p.nickname === p.species ? '' : `${pretty(p.species)} `}Lv{p.level}</span>
            {p.status !== 'OK' && <span className="status">{p.status}</span>}
            <HpBar hp={p.hp} max={p.maxHp} />
            <span className="num">{p.hp}/{p.maxHp}</span>
          </div>
          <div className="moves">{p.moves.map((m) => <span key={m.name} className={m.pp === 0 ? 'out' : ''}>{pretty(m.name)} <em>{m.pp}/{m.maxPp}</em></span>)}</div>
        </div>
      ))}
    </section>
  );
}

export function BattlePanel({ state }: { state: GameSnapshot }) {
  if (!state.battle) return null;
  const e = state.battle.enemy;
  return (
    <section className="panel battle">
      <h2>Battle <span>{state.battle.kind === 'wild' ? 'wild Pokémon' : 'trainer'}</span></h2>
      <div className="mon-top">
        <b>{pretty(e.species)}</b><span className="dim">Lv{e.level}</span>
        {e.status !== 'OK' && <span className="status">{e.status}</span>}
        <HpBar hp={e.hp} max={e.maxHp} />
      </div>
    </section>
  );
}

export function BagPanel({ state }: { state: GameSnapshot }) {
  return (
    <section className="panel">
      <h2>Bag &amp; trainer <span>{state.map ? pretty(state.map) : '—'}</span></h2>
      <p className="facts">
        <span>¥{state.money.toLocaleString('en-US')}</span><span>{state.badges} {state.badges === 1 ? 'badge' : 'badges'}</span>
        <span>Pokédex {state.pokedex.seen} seen · {state.pokedex.owned} owned</span><span>{state.playTime} played</span>
      </p>
      <div className="chips">
        {state.bag.length === 0 && <span className="dim">The bag is empty.</span>}
        {state.bag.map((i) => <span className="chip" key={i.name}>{pretty(i.name)} <em>×{i.qty}</em></span>)}
      </div>
    </section>
  );
}
