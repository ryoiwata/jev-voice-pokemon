import type { IconKind } from './itemIcon';

const INK = '#1c1a3a';
const line = { stroke: INK, strokeWidth: 1.6, strokeLinejoin: 'round' as const };

/** Small drawn icons for the bag. Pokémon Red has no pictures for items, so these are our own. */
export function ItemIcon({ kind }: { kind: IconKind }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="icon">
      {kind === 'ball' && <><circle cx="10" cy="10" r="8" fill="#fff" {...line} /><path d="M2 10a8 8 0 0 1 16 0z" fill="#d8342c" {...line} /><circle cx="10" cy="10" r="2.6" fill="#fff" {...line} /></>}
      {kind === 'medicine' && <><rect x="5.5" y="7" width="9" height="11" rx="2.2" fill="#b9a6f5" {...line} /><rect x="8" y="2" width="4" height="5" fill="#e4e2f0" {...line} /></>}
      {kind === 'heal' && <><rect x="3" y="6" width="14" height="8" rx="4" fill="#fff" {...line} /><path d="M10 6v8" {...line} /><path d="M3.4 9a4 4 0 0 1 6.6-3v8a4 4 0 0 1-6.6-3z" fill="#2fa36b" {...line} /></>}
      {kind === 'disc' && <><circle cx="10" cy="10" r="8" fill="#ffd23f" {...line} /><circle cx="10" cy="10" r="2.4" fill="#fff" {...line} /></>}
      {kind === 'stone' && <path d="M10 2l6 5-2 9H6L4 7z" fill="#7fd0c8" {...line} />}
      {kind === 'key' && <><circle cx="6.5" cy="10" r="3.8" fill="#ffd23f" {...line} /><path d="M10.3 10H18M15 10v3.4M17.6 10v2.4" fill="none" {...line} strokeLinecap="round" /></>}
      {kind === 'box' && <><rect x="3" y="5" width="14" height="11" rx="1.5" fill="#e4e2f0" {...line} /><path d="M3 9h14M8.5 9v3h3V9" fill="none" {...line} /></>}
    </svg>
  );
}
