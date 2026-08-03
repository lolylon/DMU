import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, ConnectionState } from 'livekit-client';

export function VideoRoom({
  livekitUrl,
  token,
  onLeave,
}: {
  livekitUrl: string;
  token: string;
  onLeave?: () => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState('Подключение…');
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const r = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = r;

    (async () => {
      try {
        r.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === Track.Kind.Video || track.kind === Track.Kind.Audio) {
            const el = track.attach();
            el.style.width = '100%';
            remoteRef.current?.appendChild(el);
          }
        });
        r.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()));
        r.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
          if (state === ConnectionState.Reconnecting) setStatus('Переподключение…');
          if (state === ConnectionState.Connected) setStatus('В сессии');
        });
        r.on(RoomEvent.Disconnected, () => {
          if (!cancelled) {
            setConnected(false);
            setStatus('Отключено');
          }
        });

        setStatus('Подключение к медиасерверу…');
        await r.connect(livekitUrl, token);
        if (cancelled) return r.disconnect();
        setConnected(true);

        const notes: string[] = [];
        try {
          await r.localParticipant.setMicrophoneEnabled(true);
        } catch {
          notes.push('микрофон недоступен');
        }
        try {
          await r.localParticipant.setCameraEnabled(true);
          const cam = r.localParticipant.getTrackPublication(Track.Source.Camera);
          if (cam?.track && localRef.current) cam.track.attach(localRef.current);
        } catch {
          notes.push('камера недоступна');
        }
        setStatus(notes.length ? `В сессии (${notes.join(', ')})` : 'В сессии');
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Ошибка';
        setStatus(
          /getUserMedia|Permission|NotFound|NotAllowed/i.test(msg)
            ? `Медиа: ${msg}`
            : `Нет связи с видеосервером (${livekitUrl}): ${msg}`,
        );
      }
    })();

    return () => {
      cancelled = true;
      r.disconnect();
      roomRef.current = null;
    };
  }, [livekitUrl, token]);

  return (
    <div className="video-wrap">
      <p className="muted">{status}</p>
      <video ref={localRef} autoPlay playsInline muted style={{ width: '100%', borderRadius: 10 }} />
      <div ref={remoteRef} />
      <button
        type="button"
        onClick={() => {
          roomRef.current?.disconnect();
          onLeave?.();
        }}
      >
        {connected ? 'Выйти из видео' : 'Закрыть'}
      </button>
    </div>
  );
}
