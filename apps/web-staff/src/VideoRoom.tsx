import { useEffect, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  ConnectionState,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from 'livekit-client';

type Props = {
  livekitUrl: string;
  token: string;
  onLeave?: () => void;
};

export function VideoRoom({ livekitUrl, token, onLeave }: Props) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState('Подключение…');
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const r = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = r;

    async function enableMedia() {
      const notes: string[] = [];
      try {
        await r.localParticipant.setMicrophoneEnabled(true);
      } catch {
        notes.push('микрофон недоступен');
      }
      try {
        await r.localParticipant.setCameraEnabled(true);
        const cam = r.localParticipant.getTrackPublication(Track.Source.Camera);
        if (cam?.track && localRef.current) {
          cam.track.attach(localRef.current);
        }
      } catch {
        notes.push('камера недоступна');
      }
      return notes;
    }

    async function connect() {
      try {
        r.on(RoomEvent.TrackSubscribed, (track, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
          if (track.kind === Track.Kind.Video || track.kind === Track.Kind.Audio) {
            const el = track.attach();
            el.style.width = '100%';
            el.style.background = '#111';
            el.dataset.participant = participant.identity;
            remoteRef.current?.appendChild(el);
          }
        });
        r.on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach().forEach((el) => el.remove());
        });
        r.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
          if (state === ConnectionState.Reconnecting) setStatus('Переподключение…');
          if (state === ConnectionState.Connected) {
            setStatus(`В сессии · участников: ${r.numParticipants}`);
          }
        });
        r.on(RoomEvent.Disconnected, () => {
          if (!cancelled) {
            setConnected(false);
            setStatus('Отключено — можно переподключиться');
          }
        });
        r.on(RoomEvent.ParticipantConnected, () => {
          setStatus(`В сессии · участников: ${r.numParticipants}`);
        });
        r.on(RoomEvent.ParticipantDisconnected, () => {
          setStatus(`В сессии · участников: ${r.numParticipants}`);
        });

        setStatus('Подключение к медиасерверу…');
        await r.connect(livekitUrl, token);
        if (cancelled) {
          r.disconnect();
          return;
        }
        setConnected(true);
        const mediaNotes = await enableMedia();
        if (cancelled) return;
        const base = `В сессии · участников: ${r.numParticipants}`;
        setStatus(mediaNotes.length ? `${base} (${mediaNotes.join(', ')})` : base);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Ошибка подключения';
        setStatus(
          /getUserMedia|Permission|NotFound|NotAllowed/i.test(msg)
            ? `Медиа: ${msg}. Сессию можно продолжить после разрешения камеры/микрофона.`
            : `Нет связи с видеосервером (${livekitUrl}): ${msg}`,
        );
        setConnected(false);
      }
    }

    void connect();
    return () => {
      cancelled = true;
      r.disconnect();
      roomRef.current = null;
    };
  }, [livekitUrl, token]);

  async function hangup() {
    roomRef.current?.disconnect();
    onLeave?.();
  }

  return (
    <div className="video-wrap">
      <p className="muted">{status}</p>
      <div className="video-grid">
        <video ref={localRef} autoPlay playsInline muted className="local" />
        <div ref={remoteRef} className="remote" />
      </div>
      <button type="button" onClick={() => void hangup()}>
        {connected ? 'Выйти из видео' : 'Закрыть'}
      </button>
    </div>
  );
}
