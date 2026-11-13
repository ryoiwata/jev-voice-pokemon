import { useEffect, useRef, useState, useCallback } from 'react';
import type { ClientMsg, ServerMsg, LogEntry, SessionInfo } from '../../src/server/wire';
import { TAG_FRAME, TAG_AUDIO } from '../../src/server/wire';
import type { GameSnapshot } from '../../src/game/snapshot';

export interface Connection {
  connected: boolean;
  state: GameSnapshot | null;
  session: SessionInfo | null;
  log: LogEntry[];
  saves: string[];
  send(m: ClientMsg): void;
  /** called for every video frame (RGBA, 160x144) with the buttons held during it (see buttonMask) */
  onFrame: React.MutableRefObject<((rgba: Uint8Array, mask: number) => void) | null>;
  /** called for every chunk of sound (Int16 stereo) */
  onAudio: React.MutableRefObject<((pcm: Int16Array) => void) | null>;
  /** called the moment a log entry arrives or changes, before the page redraws */
  onLog: React.MutableRefObject<((entry: LogEntry) => void) | null>;
}

const MAX_LOG = 200;

/** One WebSocket to the local server, reconnecting if the server restarts. */
export function useConnection(): Connection {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<GameSnapshot | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [saves, setSaves] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const onFrame = useRef<((rgba: Uint8Array, mask: number) => void) | null>(null);
  const onAudio = useRef<((pcm: Int16Array) => void) | null>(null);
  const onLog = useRef<((entry: LogEntry) => void) | null>(null);

  useEffect(() => {
    let closed = false, retry: ReturnType<typeof setTimeout>;
    const open = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => { setConnected(false); if (!closed) retry = setTimeout(open, 1000); };
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') {
          const bytes = new Uint8Array(e.data as ArrayBuffer);
          if (bytes[0] === TAG_FRAME) onFrame.current?.(bytes.subarray(2), bytes[1]);
          else if (bytes[0] === TAG_AUDIO) onAudio.current?.(new Int16Array(bytes.slice(1).buffer));
          return;
        }
        const m = JSON.parse(e.data) as ServerMsg;
        if (m.type === 'state') setState(m.state);
        else if (m.type === 'session') setSession(m);
        else if (m.type === 'saves') setSaves(m.names);
        else if (m.type === 'log') { onLog.current?.(m.entry); setLog((old) => {
          const i = old.findIndex((x) => x.id === m.entry.id);
          if (i >= 0) { const next = old.slice(); next[i] = m.entry; return next; }
          return [...old, m.entry].slice(-MAX_LOG);
        }); }
      };
    };
    open();
    return () => { closed = true; clearTimeout(retry); wsRef.current?.close(); };
  }, []);

  const send = useCallback((m: ClientMsg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  }, []);

  return { connected, state, session, log, saves, send, onFrame, onAudio, onLog };
}
