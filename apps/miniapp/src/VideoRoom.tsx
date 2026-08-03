import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';

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
  const [status, setStatus] = useState('Подключение…');
  const [room, setRoom] = useState<Room | null>(null);

  useEffect(() => {
    const r = new Room({ adaptiveStream: true, dynacast: true });
    let cancelled = false;
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
        await r.connect(livekitUrl, token);
        if (cancelled) return r.disconnect();
        await r.localParticipant.setCameraEnabled(true);
        await r.localParticipant.setMicrophoneEnabled(true);
        const cam = r.localParticipant.getTrackPublication(Track.Source.Camera);
        if (cam?.track && localRef.current) cam.track.attach(localRef.current);
        setStatus('В сессии');
        setRoom(r);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : 'Ошибка');
      }
    })();
    return () => {
      cancelled = true;
      r.disconnect();
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
          room?.disconnect();
          onLeave?.();
        }}
      >
        Выйти из видео
      </button>
    </div>
  );
}
