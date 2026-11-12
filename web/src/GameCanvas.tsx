import { useEffect, useRef } from 'react';
import type { Connection } from './ws';

const W = 160, H = 144;

/** The live game picture. Clicking a spot asks the server to go there (col/row are 16px game tiles). */
export function GameCanvas({ conn, onTile }: { conn: Connection; onTile?: (col: number, row: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const g = ref.current!.getContext('2d')!;
    const img = g.createImageData(W, H);
    conn.onFrame.current = (rgba) => {
      if (rgba.length !== W * H * 4) return;
      img.data.set(rgba);
      g.putImageData(img, 0, 0);
    };
    return () => { conn.onFrame.current = null; };
  }, [conn.onFrame]);

  return (
    <canvas
      ref={ref} width={W} height={H} className="game" aria-label="Game screen"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const col = Math.min(9, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * 10)));
        const row = Math.min(8, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * 9)));
        onTile?.(col, row);
      }}
    />
  );
}
