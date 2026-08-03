import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators';

const DOSSIER_SLA_MS = 60_000;

@Injectable()
export class DossierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Assemble single-case evidence package (architecture W3: ≤60s).
   * Batch-for-period deferred to [Ж].
   */
  async assemble(actor: AuthUser, caseId: string) {
    const started = Date.now();
    const caseRow = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: {
        patient: { select: { id: true, fullName: true, organizationId: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        participants: true,
        acceptances: {
          include: {
            consentDocument: {
              select: { id: true, kind: true, version: true, language: true, contentHash: true },
            },
          },
        },
        sessions: {
          include: {
            recording: true,
            participants: true,
          },
        },
        chatMessages: { orderBy: { createdAt: 'asc' }, take: 2000 },
        files: { orderBy: { createdAt: 'asc' } },
        conclusion: {
          include: { versions: { orderBy: { versionNumber: 'asc' } } },
        },
        appointments: {
          include: { slot: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!caseRow) throw new NotFoundException('Case not found');
    this.assertAccess(actor, caseRow);

    const items: Array<{
      kind: string;
      id: string;
      checksumSha256?: string | null;
      storageKey?: string | null;
      meta?: Record<string, unknown>;
    }> = [];

    for (const h of caseRow.statusHistory) {
      items.push({ kind: 'status_history', id: h.id, meta: { from: h.fromStatus, to: h.toStatus } });
    }
    for (const a of caseRow.acceptances) {
      items.push({
        kind: 'consent_acceptance',
        id: a.id,
        checksumSha256: a.consentDocument.contentHash,
        meta: {
          documentId: a.consentDocument.id,
          kind: a.consentDocument.kind,
          version: a.consentDocument.version,
        },
      });
    }
    for (const s of caseRow.sessions) {
      items.push({
        kind: 'session',
        id: s.id,
        checksumSha256: s.recording?.checksumSha256,
        storageKey: s.recording?.storageKey,
        meta: { status: s.status, room: s.livekitRoomName },
      });
    }
    for (const m of caseRow.chatMessages) {
      items.push({
        kind: 'chat',
        id: m.id,
        checksumSha256: createHash('sha256').update(m.body, 'utf8').digest('hex'),
      });
    }
    for (const f of caseRow.files) {
      items.push({
        kind: 'file',
        id: f.id,
        checksumSha256: f.checksumSha256,
        storageKey: f.storageKey,
        meta: { fileName: f.fileName, contentType: f.contentType },
      });
    }
    if (caseRow.conclusion) {
      for (const v of caseRow.conclusion.versions) {
        items.push({
          kind: 'conclusion_version',
          id: v.id,
          checksumSha256: v.contentHash,
          storageKey: v.pdfStorageKey,
          meta: { versionNumber: v.versionNumber, signedAt: v.signedAt },
        });
      }
    }

    // Integrity: every artifact with a checksum must be 64 hex
    for (const it of items) {
      if (it.checksumSha256 && !/^[a-f0-9]{64}$/i.test(it.checksumSha256)) {
        throw new ServiceUnavailableException(`Corrupt checksum on ${it.kind}:${it.id}`);
      }
    }

    const packageBody = {
      schemaVersion: 1,
      assembledAt: new Date().toISOString(),
      timezone: 'Asia/Almaty',
      case: {
        id: caseRow.id,
        organizationId: caseRow.organizationId,
        status: caseRow.status,
        mode: caseRow.mode,
        profileCode: caseRow.profileCode,
        createdAt: caseRow.createdAt,
        patient: {
          id: caseRow.patient.id,
          fullName: caseRow.patient.fullName,
        },
      },
      appointments: caseRow.appointments.map((a) => ({
        id: a.id,
        status: a.status,
        startsAt: a.slot.startsAt,
        endsAt: a.slot.endsAt,
      })),
      statusHistory: caseRow.statusHistory,
      consents: caseRow.acceptances.map((a) => ({
        id: a.id,
        method: a.method,
        acceptedAt: a.acceptedAt,
        document: a.consentDocument,
      })),
      sessions: caseRow.sessions.map((s) => ({
        id: s.id,
        status: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        recording: s.recording
          ? {
              status: s.recording.status,
              storageKey: s.recording.storageKey,
              checksumSha256: s.recording.checksumSha256,
              byteSize: s.recording.byteSize,
            }
          : null,
      })),
      chat: caseRow.chatMessages.map((m) => ({
        id: m.id,
        authorId: m.authorId,
        createdAt: m.createdAt,
        bodySha256: createHash('sha256').update(m.body, 'utf8').digest('hex'),
        // body included for clinical dossier (PMD) — auditor/consultant only
        body: m.body,
      })),
      files: caseRow.files,
      conclusion: caseRow.conclusion
        ? {
            id: caseRow.conclusion.id,
            status: caseRow.conclusion.status,
            fields: {
              complaints: caseRow.conclusion.complaints,
              anamnesis: caseRow.conclusion.anamnesis,
              examination: caseRow.conclusion.examination,
              conclusionText: caseRow.conclusion.conclusionText,
              recommendations: caseRow.conclusion.recommendations,
              authorPosition: caseRow.conclusion.authorPosition,
            },
            versions: caseRow.conclusion.versions.map((v) => ({
              id: v.id,
              versionNumber: v.versionNumber,
              contentHash: v.contentHash,
              signedAt: v.signedAt,
              certSubject: v.certSubject,
              verificationOk: v.verificationOk,
              pdfStorageKey: v.pdfStorageKey,
              // CMS omitted from export package listing size; stored separately in DB
              hasCms: Boolean(v.cmsSignature),
            })),
          }
        : null,
      evidenceIndex: items,
    };

    const json = JSON.stringify(packageBody);
    const checksumSha256 = createHash('sha256').update(json, 'utf8').digest('hex');
    const assemblyMs = Date.now() - started;

    if (assemblyMs > DOSSIER_SLA_MS) {
      throw new ServiceUnavailableException(
        `Dossier assembly exceeded 60s SLA (${assemblyMs}ms) — reduce case size or optimize`,
      );
    }

    const storageKey = `dossiers/${caseRow.organizationId}/${caseId}/${Date.now()}.json`;
    await this.storage.putArtifactObject(storageKey, Buffer.from(json, 'utf8'), 'application/json');

    const row = await this.prisma.caseDossier.create({
      data: {
        organizationId: caseRow.organizationId,
        caseId,
        storageKey,
        checksumSha256,
        byteSize: Buffer.byteLength(json, 'utf8'),
        assemblyMs,
        itemCount: items.length,
        createdById: actor.id,
      },
    });

    await this.audit.logAccess({
      userId: actor.id,
      organizationId: caseRow.organizationId,
      objectType: 'dossier',
      objectId: caseId,
      action: 'assemble',
    });

    const url = await this.storage.signedGetUrl('artifacts', storageKey, 300);
    return {
      dossierId: row.id,
      caseId,
      checksumSha256,
      byteSize: row.byteSize,
      itemCount: row.itemCount,
      assemblyMs,
      slaMs: DOSSIER_SLA_MS,
      withinSla: assemblyMs <= DOSSIER_SLA_MS,
      url,
    };
  }

  async latest(actor: AuthUser, caseId: string) {
    const caseRow = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { participants: true },
    });
    if (!caseRow) throw new NotFoundException('Case not found');
    this.assertAccess(actor, caseRow);

    const row = await this.prisma.caseDossier.findFirst({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    const url = await this.storage.signedGetUrl('artifacts', row.storageKey, 300);
    return { ...row, url };
  }

  private assertAccess(
    actor: AuthUser,
    caseRow: { organizationId: string; participants: { userId: string }[] },
  ) {
    const orgOk = actor.memberships.some((m) => m.organizationId === caseRow.organizationId);
    if (!orgOk) throw new ForbiddenException('No membership');

    const allowed = actor.memberships.some(
      (m) =>
        m.organizationId === caseRow.organizationId &&
        (
          [
            MembershipRole.CONSULTANT,
            MembershipRole.DEPARTMENT_HEAD,
            MembershipRole.ORG_ADMIN,
            MembershipRole.AUDITOR,
            MembershipRole.REGISTRAR,
            MembershipRole.AMBULATORY_WORKER,
          ] as MembershipRole[]
        ).includes(m.role),
    );
    if (!allowed) throw new ForbiddenException('No dossier access');
  }
}
