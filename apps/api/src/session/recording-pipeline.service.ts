import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AccessToken,
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  RoomServiceClient,
  S3Upload,
} from 'livekit-server-sdk';
import { StorageService } from '../storage/storage.service';

/**
 * TZ 6.3.3 — session must not start if recording subsystem is unavailable.
 * Production: REQUIRE_LIVEKIT_EGRESS=true (or NODE_ENV=production) requires Egress API.
 * Dev: may run without egress; finalize stores evidence envelope and marks mode honestly.
 */
@Injectable()
export class RecordingPipelineService {
  private readonly logger = new Logger(RecordingPipelineService.name);

  constructor(private readonly storage: StorageService) {}

  livekitHttpHost() {
    const ws = process.env.LIVEKIT_URL ?? 'ws://localhost:7880';
    return ws.replace('ws://', 'http://').replace('wss://', 'https://');
  }

  apiKey() {
    return process.env.LIVEKIT_API_KEY ?? 'mirudevkey';
  }

  apiSecret() {
    return process.env.LIVEKIT_API_SECRET ?? 'miru_livekit_dev_secret_change_me_32chars';
  }

  requiresEgress() {
    return (
      process.env.REQUIRE_LIVEKIT_EGRESS === 'true' ||
      process.env.NODE_ENV === 'production'
    );
  }

  roomService() {
    return new RoomServiceClient(this.livekitHttpHost(), this.apiKey(), this.apiSecret());
  }

  egressClient() {
    return new EgressClient(this.livekitHttpHost(), this.apiKey(), this.apiSecret());
  }

  async assertReadyOrThrow() {
    try {
      await this.storage.assertHealthy();
    } catch (e) {
      this.logger.error('Recording storage unhealthy', e as Error);
      throw new ServiceUnavailableException(
        'Recording subsystem unavailable. Session cannot start — please reschedule (TZ 6.3.3)',
      );
    }

    try {
      await this.roomService().listRooms();
    } catch (e) {
      this.logger.error('LiveKit unhealthy', e as Error);
      throw new ServiceUnavailableException(
        'Video subsystem unavailable. Session cannot start — please reschedule (TZ 6.3.3)',
      );
    }

    if (this.requiresEgress()) {
      try {
        await this.egressClient().listEgress({ roomName: '__healthcheck_none__' });
      } catch (e) {
        // listEgress may 404/empty — connection errors matter
        const msg = e instanceof Error ? e.message : String(e);
        if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(msg)) {
          this.logger.error('LiveKit Egress unhealthy', e as Error);
          throw new ServiceUnavailableException(
            'Recording egress unavailable. Session cannot start — please reschedule (TZ 6.3.3)',
          );
        }
        // Other errors (not found room) mean API is reachable
        this.logger.debug(`Egress health probe: ${msg}`);
      }
    }

    return true;
  }

  async createRoom(roomName: string) {
    await this.roomService().createRoom({
      name: roomName,
      emptyTimeout: 60 * 30,
      maxParticipants: 8,
    });
  }

  async startRoomCompositeEgress(input: {
    roomName: string;
    filepath: string;
  }): Promise<{ egressId: string | null; mode: 'egress' | 'envelope_only' }> {
    if (!this.requiresEgress() && process.env.LIVEKIT_EGRESS_ENABLED !== 'true') {
      this.logger.warn('Egress not enabled — session will use evidence envelope only');
      return { egressId: null, mode: 'envelope_only' };
    }

    try {
      const s3 = new S3Upload({
        accessKey: process.env.S3_ACCESS_KEY ?? 'miru_minio',
        secret: process.env.S3_SECRET_KEY ?? 'miru_dev_only_change_me',
        bucket: process.env.S3_BUCKET_RECORDINGS ?? 'miru-recordings',
        endpoint: process.env.S3_ENDPOINT ?? 'http://minio:9000',
        region: process.env.S3_REGION ?? 'us-east-1',
        forcePathStyle: true,
      });
      const fileOutput = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath: input.filepath,
        output: { case: 's3', value: s3 },
      });
      const info = await this.egressClient().startRoomCompositeEgress(input.roomName, {
        file: fileOutput,
      });
      return { egressId: info.egressId, mode: 'egress' };
    } catch (e) {
      this.logger.error('Failed to start RoomCompositeEgress', e as Error);
      if (this.requiresEgress()) {
        throw new ServiceUnavailableException(
          'Cannot start recording egress. Session cannot start — please reschedule (TZ 6.3.3)',
        );
      }
      return { egressId: null, mode: 'envelope_only' };
    }
  }

  async stopEgress(egressId: string | null | undefined) {
    if (!egressId) return;
    try {
      await this.egressClient().stopEgress(egressId);
    } catch (e) {
      this.logger.warn(`stopEgress ${egressId}: ${e instanceof Error ? e.message : e}`);
    }
  }

  async mintJoinToken(input: {
    roomName: string;
    identity: string;
    name: string;
    metadata?: string;
  }) {
    const at = new AccessToken(this.apiKey(), this.apiSecret(), {
      identity: input.identity,
      name: input.name,
      metadata: input.metadata,
      ttl: '2h',
    });
    at.addGrant({
      roomJoin: true,
      room: input.roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    return at.toJwt();
  }

  async finalizeRecordingObject(input: {
    storageKey: string;
    payload: object;
  }) {
    const body = Buffer.from(JSON.stringify(input.payload, null, 2), 'utf8');
    return this.storage.putRecordingObject(input.storageKey, body, 'application/json');
  }
}
