import { useEffect, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  Track,
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
  const [status, setStatus] = useState('Подключение…');
  const [room, setRoom] = useState<Room | null>(null);

  useEffect(() => {
    const r = new Room({ adaptiveStream: true, dynacast: true });
    let cancelled = false;

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
        r.on(RoomEvent.Disconnected, () => setStatus('Отключено — можно переподключиться'));

        await r.connect(livekitUrl, token);
        if (cancelled) {
          r.disconnect();
          return;
        }
        await r.localParticipant.setCameraEnabled(true);
        await r.localParticipant.setMicrophoneEnabled(true);
        const cam = r.localParticipant.getTrackPublication(Track.Source.Camera);
        if (cam?.track && localRef.current) {
          cam.track.attach(localRef.current);
        }
        setStatus(`В сессии · участников: ${r.numParticipants}`);
        setRoom(r);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : 'Ошибка подключения');
      }
    }

    void connect();
    return () => {
      cancelled = true;
      r.disconnect();
    };
  }, [livekitUrl, token]);

  async function hangup() {
    room?.disconnect();
    onLeave?.();
  }

  return (
    <div className="video-wrap">
      <p className="muted">{status}</p>
      <div className="video-grid">
        <video ref={localRef} autoPlay playsInline muted className="local" />
        <div ref={remoteRef} className="remote" />
      </div>
      <button type="button" onClick={hangup}>
        Выйти из видео
      </button>
    </div>
  );
}
