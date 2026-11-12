import { useEffect, useMemo, useState } from 'react';
import { GameAudio } from './audio';
import type { Connection } from './ws';

/** Mute button and volume slider. Shows a prompt until the browser lets sound start. */
export function VolumeControl({ conn }: { conn: Connection }) {
  const audio = useMemo(() => new GameAudio(), []);
  const [, redraw] = useState(0);
  const tick = () => redraw((n) => n + 1);

  useEffect(() => {
    conn.onAudio.current = (pcm) => audio.push(pcm);
    const wake = () => { if (audio.needsGesture) audio.resume().then(tick); };
    window.addEventListener('pointerdown', wake); window.addEventListener('keydown', wake);
    return () => { conn.onAudio.current = null; window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake); };
  }, [audio, conn.onAudio]);

  if (audio.needsGesture) return <button type="button" className="sound-on" onClick={() => audio.resume().then(tick)}>🔇 Click to enable sound</button>;
  return (
    <span className="volume">
      <button type="button" className="mute" aria-label={audio.muted ? 'Unmute' : 'Mute'} aria-pressed={audio.muted} onClick={() => { audio.setMuted(!audio.muted); tick(); }}>{audio.muted ? '🔇' : '🔊'}</button>
      <input type="range" min={0} max={1} step={0.05} value={audio.volume} aria-label="Volume" onChange={(e) => { audio.setVolume(+e.target.value); tick(); }} />
    </span>
  );
}
