import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  CaseStatus,
  MembershipRole,
  RecordingStatus,
  SessionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators';
import { RecordingPipelineService } from './recording-pipeline.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { randomUUID } from 'crypto';

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: RecordingPipelineService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * TZ 6.3 — start session only if recording pipeline healthy; move case BOOKED → IN_SESSION.
   */
  async startSession(actor: AuthUser, caseId: string) {
    const caseRow = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { participants: true, patient: true, appointments: { where: { status: AppointmentStatus.ACTIVE }, take: 1 } },
    });
    if (!caseRow) throw new NotFoundException('Case not found');
    this.assertCaseAccess(actor, caseRow);

    if (caseRow.status !== CaseStatus.BOOKED && caseRow.status !== CaseStatus.IN_SESSION) {
      throw new BadRequestException(`Case status ${caseRow.status} does not allow starting session`);
    }

    const existingLive = await this.prisma.consultationSession.findFirst({
      where: { caseId, status: { in: [SessionStatus.LIVE, SessionStatus.PENDING_RECORDING] } },
      include: { recording: true },
    });
    if (existingLive) {
      return this.joinSession(actor, existingLive.id);
    }

    // TZ 6.3.3 gate
    await this.pipeline.assertReadyOrThrow();

    const roomName = `case_${caseId}_${randomUUID().slice(0, 8)}`;
    const storageKey = `sessions/${caseRow.organizationId}/${caseId}/${roomName}/recording.json`;

    try {
      await this.pipeline.createRoom(roomName);
    } catch (e) {
      throw new ServiceUnavailableException(
        'Cannot create media room. Session cannot start — please reschedule (TZ 6.3.3)',
      );
    }

    const mediaPath = `sessions/${caseRow.organizationId}/${caseId}/${roomName}/composite.mp4`;
    const egress = await this.pipeline.startRoomCompositeEgress({
      roomName,
      filepath: mediaPath,
    });

    const session = await this.prisma.$transaction(async (tx) => {
      const s = await tx.consultationSession.create({
        data: {
          organizationId: caseRow.organizationId,
          caseId,
          livekitRoomName: roomName,
          status: SessionStatus.LIVE,
          startedAt: new Date(),
          recording: {
            create: {
              status: RecordingStatus.ACTIVE,
              storageKey,
              egressId: egress.egressId,
            },
          },
          participants: {
            create: {
              userId: actor.id,
              role: this.actorRoleOnCase(actor, caseRow.organizationId),
              joinedAt: new Date(),
            },
          },
        },
        include: { recording: true, participants: true },
      });

      if (caseRow.status === CaseStatus.BOOKED) {
        await tx.case.update({
          where: { id: caseId },
          data: { status: CaseStatus.IN_SESSION },
        });
        await tx.caseStatusHistory.create({
          data: {
            caseId,
            fromStatus: CaseStatus.BOOKED,
            toStatus: CaseStatus.IN_SESSION,
            actorId: actor.id,
            reason: 'session_started',
          },
        });
      }

      return s;
    });

    const token = await this.pipeline.mintJoinToken({
      roomName,
      identity: actor.id,
      name: actor.displayName,
      metadata: JSON.stringify({ role: this.actorRoleOnCase(actor, caseRow.organizationId) }),
    });

    await this.audit.logAccess({
      userId: actor.id,
      organizationId: caseRow.organizationId,
      objectType: 'session',
      objectId: session.id,
      action: 'session_start',
      role: String(this.actorRoleOnCase(actor, caseRow.organizationId)),
    });

    return {
      sessionId: session.id,
      caseId,
      status: session.status,
      livekitUrl: this.pipeline.clientLivekitUrl(),
      token,
      roomName,
      recording: {
        id: session.recording!.id,
        status: session.recording!.status,
        storageKey: session.recording!.storageKey,
        egressId: egress.egressId,
        mode: egress.mode,
      },
    };
  }

  async joinSession(actor: AuthUser, sessionId: string) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { id: sessionId },
      include: {
        recording: true,
        case: { include: { participants: true, patient: true } },
        participants: true,
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== SessionStatus.LIVE && session.status !== SessionStatus.PENDING_RECORDING) {
      throw new BadRequestException('Session is not joinable');
    }
    this.assertCaseAccess(actor, session.case);

    if (!session.recording || session.recording.status === RecordingStatus.FAILED) {
      throw new ServiceUnavailableException(
        'Recording subsystem unavailable. Session cannot continue — please reschedule (TZ 6.3.3)',
      );
    }

    // Ensure client URL is home-reachable before minting a join token
    this.pipeline.clientLivekitUrl();

    await this.prisma.sessionParticipant.upsert({
      where: {
        sessionId_userId: { sessionId, userId: actor.id },
      },
      create: {
        sessionId,
        userId: actor.id,
        role: this.actorRoleOnCase(actor, session.organizationId),
        joinedAt: new Date(),
      },
      update: {
        joinedAt: new Date(),
        leftAt: null,
      },
    });

    const token = await this.pipeline.mintJoinToken({
      roomName: session.livekitRoomName,
      identity: actor.id,
      name: actor.displayName,
      metadata: JSON.stringify({ role: this.actorRoleOnCase(actor, session.organizationId) }),
    });

    await this.audit.logAccess({
      userId: actor.id,
      organizationId: session.organizationId,
      objectType: 'session',
      objectId: session.id,
      action: 'session_join',
    });

    return {
      sessionId: session.id,
      caseId: session.caseId,
      status: session.status,
      livekitUrl: this.pipeline.clientLivekitUrl(),
      token,
      roomName: session.livekitRoomName,
      recording: {
        id: session.recording.id,
        status: session.recording.status,
        storageKey: session.recording.storageKey,
      },
    };
  }

  async endSession(actor: AuthUser, sessionId: string) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { id: sessionId },
      include: {
        recording: true,
        participants: true,
        case: { include: { participants: true, patient: true } },
        chatMessages: true,
        files: true,
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    this.assertCaseAccess(actor, session.case);
    if (session.status === SessionStatus.ENDED) {
      return { ok: true, sessionId, status: session.status };
    }

    const endedAt = new Date();
    const startedAt = session.startedAt ?? session.createdAt;
    const durationSec = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));

    // Mark participants left
    await this.prisma.sessionParticipant.updateMany({
      where: { sessionId, leftAt: null },
      data: { leftAt: endedAt },
    });

    const manifest = {
      sessionId: session.id,
      caseId: session.caseId,
      organizationId: session.organizationId,
      livekitRoomName: session.livekitRoomName,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationSec,
      egressId: session.recording?.egressId ?? null,
      recordingMode: session.recording?.egressId ? 'egress' : 'envelope_only',
      participants: session.participants.map((p) => ({
        userId: p.userId,
        role: p.role,
        joinedAt: p.joinedAt,
        leftAt: p.leftAt ?? endedAt,
      })),
      chatMessageCount: session.chatMessages.length,
      fileCount: session.files.length,
      note: session.recording?.egressId
        ? 'Media egress started; envelope checksum stored. Media object under same session prefix when egress completes.'
        : 'Evidence envelope only (egress not enabled). Enable LIVEKIT_EGRESS_ENABLED / REQUIRE_LIVEKIT_EGRESS for A/V.',
    };

    await this.pipeline.stopEgress(session.recording?.egressId);

    let finalized;
    try {
      finalized = await this.pipeline.finalizeRecordingObject({
        storageKey: session.recording!.storageKey,
        payload: manifest,
      });
    } catch {
      await this.prisma.sessionRecording.update({
        where: { id: session.recording!.id },
        data: { status: RecordingStatus.FAILED, error: 'finalize_storage_failed' },
      });
      throw new ServiceUnavailableException('Failed to finalize session recording');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.sessionRecording.update({
        where: { id: session.recording!.id },
        data: {
          status: RecordingStatus.READY,
          checksumSha256: finalized.checksumSha256,
          byteSize: finalized.byteSize,
        },
      });
      await tx.consultationSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.ENDED,
          endedAt,
          durationSec,
        },
      });
      await tx.case.update({
        where: { id: session.caseId },
        data: { status: CaseStatus.AWAITING_CONCLUSION },
      });
      await tx.caseStatusHistory.create({
        data: {
          caseId: session.caseId,
          fromStatus: CaseStatus.IN_SESSION,
          toStatus: CaseStatus.AWAITING_CONCLUSION,
          actorId: actor.id,
          reason: 'session_ended',
        },
      });
    });

    await this.notifications.notifyBookingChange({
      organizationId: session.organizationId,
      caseId: session.caseId,
      templateKey: 'session_ended',
      patientRef: session.case.patientId,
      consultantRef: actor.id,
      meta: { event: 'session_ended', sessionId },
    });

    return {
      ok: true,
      sessionId,
      status: SessionStatus.ENDED,
      durationSec,
      recordingChecksum: finalized.checksumSha256,
    };
  }

  async leaveSession(actor: AuthUser, sessionId: string) {
    await this.prisma.sessionParticipant.updateMany({
      where: { sessionId, userId: actor.id, leftAt: null },
      data: { leftAt: new Date() },
    });
    return { ok: true };
  }

  async postChat(actor: AuthUser, sessionId: string, body: string) {
    if (!body.trim()) throw new BadRequestException('Empty message');
    const session = await this.prisma.consultationSession.findUnique({
      where: { id: sessionId },
      include: { case: { include: { participants: true, patient: true } } },
    });
    if (!session) throw new NotFoundException('Session not found');
    this.assertCaseAccess(actor, session.case);

    const msg = await this.prisma.chatMessage.create({
      data: {
        caseId: session.caseId,
        sessionId,
        authorId: actor.id,
        body: body.slice(0, 4000),
      },
    });
    return msg;
  }

  async listChat(actor: AuthUser, sessionId: string) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { id: sessionId },
      include: { case: { include: { participants: true, patient: true } } },
    });
    if (!session) throw new NotFoundException('Session not found');
    this.assertCaseAccess(actor, session.case);
    return this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async uploadFile(
    actor: AuthUser,
    sessionId: string,
    input: { fileName: string; contentType: string; base64: string },
  ) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { id: sessionId },
      include: { case: { include: { participants: true, patient: true } } },
    });
    if (!session) throw new NotFoundException('Session not found');
    this.assertCaseAccess(actor, session.case);

    const allowed = ['image/jpeg', 'image/png', 'application/pdf', 'image/webp'];
    if (!allowed.includes(input.contentType)) {
      throw new BadRequestException('File type not allowed');
    }
    const buf = Buffer.from(input.base64, 'base64');
    if (buf.length > 5 * 1024 * 1024) {
      throw new BadRequestException('File too large (max 5MB)');
    }

    const key = `cases/${session.caseId}/sessions/${sessionId}/${Date.now()}_${input.fileName}`;
    const stored = await this.storage.putArtifactObject(key, buf, input.contentType);

    return this.prisma.caseFile.create({
      data: {
        caseId: session.caseId,
        sessionId,
        uploadedById: actor.id,
        fileName: input.fileName,
        contentType: input.contentType,
        storageKey: stored.key,
        checksumSha256: stored.checksumSha256,
        byteSize: stored.byteSize,
      },
    });
  }

  async getActiveForCase(actor: AuthUser, caseId: string) {
    const caseRow = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { participants: true, patient: true },
    });
    if (!caseRow) throw new NotFoundException('Case not found');
    this.assertCaseAccess(actor, caseRow);
    return this.prisma.consultationSession.findFirst({
      where: { caseId, status: SessionStatus.LIVE },
      include: { recording: true, participants: true },
    });
  }

  async getRecordingUrl(actor: AuthUser, sessionId: string) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { id: sessionId },
      include: {
        recording: true,
        case: { include: { participants: true, patient: true } },
      },
    });
    if (!session?.recording) throw new NotFoundException('Recording not found');
    this.assertCaseAccess(actor, session.case);

    const url = await this.storage.signedGetUrl('recordings', session.recording.storageKey, 300);
    await this.audit.logAccess({
      userId: actor.id,
      organizationId: session.organizationId,
      objectType: 'session_recording',
      objectId: sessionId,
      action: 'download_url',
    });

    return {
      sessionId,
      status: session.recording.status,
      checksumSha256: session.recording.checksumSha256,
      egressId: session.recording.egressId,
      url,
      expiresInSec: 300,
    };
  }

  private actorRoleOnCase(actor: AuthUser, organizationId: string): MembershipRole {
    const m = actor.memberships.find((x) => x.organizationId === organizationId);
    return m?.role ?? MembershipRole.CONSULTANT;
  }

  private assertCaseAccess(
    actor: AuthUser,
    caseRow: {
      organizationId: string;
      patient: { iinHash: string };
      participants: { userId: string }[];
    },
  ) {
    const isPatientOwner =
      !!actor.iinHash &&
      caseRow.patient.iinHash === actor.iinHash &&
      actor.memberships.some((m) => m.role === MembershipRole.PATIENT);
    if (isPatientOwner) return;

    if (!actor.memberships.some((m) => m.organizationId === caseRow.organizationId)) {
      throw new ForbiddenException('No membership in organization');
    }
    const privileged = actor.memberships.some(
      (m) =>
        m.organizationId === caseRow.organizationId &&
        (
          [
            MembershipRole.CONSULTANT,
            MembershipRole.AMBULATORY_WORKER,
            MembershipRole.REGISTRAR,
            MembershipRole.DEPARTMENT_HEAD,
            MembershipRole.ORG_ADMIN,
            MembershipRole.AUDITOR,
          ] as MembershipRole[]
        ).includes(m.role),
    );
    const participant = caseRow.participants.some((p) => p.userId === actor.id);
    if (!privileged && !participant) {
      throw new ForbiddenException('No access to case session');
    }
  }
}
