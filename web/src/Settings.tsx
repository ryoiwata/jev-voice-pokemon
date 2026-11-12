import type { SessionInfo, SetKey } from '../../src/server/wire';

export function Settings({ info, set, sendDelay, setSendDelay }: { info: SessionInfo; set: (key: SetKey, value: unknown) => void; sendDelay: number; setSendDelay: (ms: number) => void }) {
  return (
    <div className="settings">
      <label><input type="checkbox" checked={info.autoAdvance} onChange={(e) => set('autoAdvance', e.target.checked)} /> Continue dialogue by itself</label>
      <label>Reading time
        <select value={info.advancePaceMs} onChange={(e) => set('advancePaceMs', +e.target.value)}>
          {[800, 1500, 2500, 4000].map((ms) => <option key={ms} value={ms}>{ms / 1000} s</option>)}
        </select>
      </label>
      <label>Voice sends after
        <select value={sendDelay} onChange={(e) => setSendDelay(+e.target.value)}>
          {[500, 800, 1200, 2000].map((ms) => <option key={ms} value={ms}>{ms / 1000} s</option>)}
        </select>
      </label>
      <label>Game speed
        <select value={info.speed} onChange={(e) => set('speed', +e.target.value)}>
          {[1, 2, 4].map((x) => <option key={x} value={x}>{x}×</option>)}
        </select>
      </label>
      <p className="dim keys">Controls mode keys: arrows move · Z = A · X = B · Enter = START · Shift = SELECT · Esc stops, in every mode.</p>
    </div>
  );
}
