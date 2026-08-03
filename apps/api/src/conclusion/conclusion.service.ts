import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { CaseStatus, ConclusionStatus, MembershipRole } from '@prisma/client';
import { canTransitionCaseStatus, type CaseStatus as SharedStatus } from '@miru/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SIGNING_PORT } from '../signing/signing.tokens';
import type { SigningPort } from '../signing/signing.port';
import {
  hashConclusionPayload,
  payloadToBase64,
  type ConclusionSignPayload,
} from '../signing/signing.port';
import { MisService } from '../mis/mis.service';
import { buildConclusionPdf } from './conclusion-pdf';

@Injectable()
export class ConclusionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    @Inject(SIGNING_PORT) private readonly signing: SigningPort,
    @Inject(forwardRef(() => MisService)) private readonly mis: MisService,
  ) {}

  async upsertDraft(
    actor: AuthUser,
    caseId: string,
    input: {
      complaints: string;
      anamnesis: string;
      examination: string;
      conclusionText: string;
      recommendations: string;
      authorPosition?: string;
    },
  ) {
    const caseRow = await this.requireCaseAccess(actor, caseId);
    if (
      caseRow.status !== CaseStatus.AWAITING_CONCLUSION &&
      caseRow.status !== CaseStatus.AWAITING_SIGNATURE
    ) {
      throw new BadRequestException(
        `Case status ${caseRow.status} does not allow editing conclusion`,
      );
    }

    const existing = await this.prisma.conclusion.findUnique({ where: { caseId } });
    if (existing?.status === ConclusionStatus.SIGNED || existing?.status === ConclusionStatus.DELIVERED) {
      throw new BadRequestException(
        'Signed conclusion is immutable — create a new version via re-open flow (TZ 6.4.6)',
      );
    }
    if (existing && existing.authorUserId !== actor.id) {
      const isHead = actor.memberships.some(
        (m) =>
          m.organizationId === caseRow.organizationId &&
          (m.role === MembershipRole.DEPARTMENT_HEAD || m.role === MembershipRole.ORG_ADMIN),
      );
      if (!isHead) {
        throw new ForbiddenException('Only author (or head) may edit this draft');
      }
    }

    const data = {
      complaints: input.complaints.trim(),
      anamnesis: input.anamnesis.trim(),
      examination: input.examination.trim(),
      conclusionText: input.conclusionText.trim(),
      recommendations: input.recommendations.trim(),
      authorPosition: (input.authorPosition ?? '').trim(),
      status: ConclusionStatus.DRAFT,
      authorUserId: existing?.authorUserId ?? actor.id,
    };

    const row = existing
      ? await this.prisma.conclusion.update({ where: { id: existing.id }, data })
      : await this.prisma.conclusion.create({
          data: {
            organizationId: caseRow.organizationId,
            caseId,
            ...data,
          },
        });

    await this.audit.logAccess({
      userId: actor.id,
      organizationId: caseRow.organizationId,
      objectType: 'conclusion',
      objectId: row.id,
      action: 'draft_save',
    });

    return this.serialize(row);
  }

  async submitForSignature(actor: AuthUser, caseId: string) {
    const caseRow = await this.requireCaseAccess(actor, caseId);
    const conclusion = await this.prisma.conclusion.findUnique({ where: { caseId } });
    if (!conclusion) throw new NotFoundException('Conclusion draft not found');
    if (conclusion.authorUserId !== actor.id) {
      throw new ForbiddenException('Only author may submit for signature');
    }
    this.assertRequiredFields(conclusion);

    if (caseRow.status === CaseStatus.AWAITING_CONCLUSION) {
      await this.transitionCase(actor, caseRow, CaseStatus.AWAITING_SIGNATURE, 'ready_to_sign');
    } else if (caseRow.status !== CaseStatus.AWAITING_SIGNATURE) {
      throw new BadRequestException(`Cannot submit from status ${caseRow.status}`);
    }

    const updated = await this.prisma.conclusion.update({
      where: { id: conclusion.id },
      data: { status: ConclusionStatus.READY_TO_SIGN },
    });

    await this.notifications.enqueue({
      organizationId: caseRow.organizationId,
      caseId,
      channel: 'web',
      templateKey: 'conclusion_ready_to_sign',
      recipientRef: actor.id,
      payloadMeta: { conclusionId: conclusion.id },
    });

    await this.audit.logAccess({
      userId: actor.id,
      organizationId: caseRow.organizationId,
      objectType: 'conclusion',
      objectId: conclusion.id,
      action: 'ready_to_sign',
    });

    return this.serialize(updated);
  }

  /** TZ 9.3.5 — batch queue for consultant */
  async signingQueue(actor: AuthUser, organizationId: string) {
    this.assertOrgMembership(actor, organizationId);
    const rows = await this.prisma.conclusion.findMany({
      where: {
        organizationId,
        status: ConclusionStatus.READY_TO_SIGN,
        authorUserId: actor.id,
      },
      orderBy: { updatedAt: 'asc' },
      include: {
        case: {
          include: { patient: { select: { id: true, fullName: true } } },
        },
      },
    });

    return rows.map((r) => ({
      ...this.serialize(r),
      case: {
        id: r.case.id,
        status: r.case.status,
        patient: r.case.patient,
      },
    }));
  }

  async getForCase(actor: AuthUser, caseId: string) {
    await this.requireCaseAccess(actor, caseId);
    const row = await this.prisma.conclusion.findUnique({
      where: { caseId },
      include: { versions: { orderBy: { versionNumber: 'asc' } } },
    });
    if (!row) return null;
    return {
      ...this.serialize(row),
      versions: row.versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        contentHash: v.contentHash,
        signedAt: v.signedAt,
        certSubject: v.certSubject,
        certSerial: v.certSerial,
        verificationOk: v.verificationOk,
        pdfStorageKey: v.pdfStorageKey,
        createdAt: v.createdAt,
        // CMS kept server-side; not returned to UI list by default
      })),
    };
  }

  /** Payload for NCALayer createCMSSignatureFromBase64 */
  async prepareSignChallenge(actor: AuthUser, caseId: string) {
    const caseRow = await this.requireCaseAccess(actor, caseId);
    const conclusion = await this.prisma.conclusion.findUnique({ where: { caseId } });
    if (!conclusion) throw new NotFoundException('Conclusion not found');
    if (conclusion.status !== ConclusionStatus.READY_TO_SIGN) {
      throw new BadRequestException('Conclusion is not ready to sign');
    }
    if (conclusion.authorUserId !== actor.id) {
      throw new ForbiddenException('Only author may sign');
    }
    if (!actor.iinHash) {
      throw new BadRequestException(
        'Consultant IIN is not bound to account — required for TZ 9.3.3 cert↔IIN match',
      );
    }
    this.assertRequiredFields(conclusion);

    const last = await this.prisma.conclusionVersion.findFirst({
      where: { conclusionId: conclusion.id },
      orderBy: { versionNumber: 'desc' },
    });
    const versionNumber = (last?.versionNumber ?? 0) + 1;

    const payload = this.buildPayload(conclusion, caseRow, actor, versionNumber);
    const contentHash = hashConclusionPayload(payload);
    const contentBase64 = payloadToBase64(payload);

    return {
      conclusionId: conclusion.id,
      caseId,
      versionNumber,
      contentHash,
      contentBase64,
      ncalayer: {
        url: 'wss://127.0.0.1:13579/',
        module: 'kz.gov.pki.knca.commonUtils',
        method: 'createCMSSignatureFromBase64',
        argsHint: ['PKCS12', '<contentBase64>', 'SIGNATURE', true],
      },
      provider: this.signing.provider,
    };
  }

  async applySignature(
    actor: AuthUser,
    caseId: string,
    input: {
      cmsBase64: string;
      signerIin: string;
      contentHash: string;
      versionNumber: number;
    },
  ) {
    const caseRow = await this.requireCaseAccess(actor, caseId);
    const conclusion = await this.prisma.conclusion.findUnique({ where: { caseId } });
    if (!conclusion) throw new NotFoundException('Conclusion not found');
    if (conclusion.status !== ConclusionStatus.READY_TO_SIGN) {
      throw new BadRequestException('Conclusion is not ready to sign');
    }
    if (conclusion.authorUserId !== actor.id) {
      throw new ForbiddenException('Only author may sign');
    }
    if (!actor.iinHash) {
      throw new BadRequestException('Consultant IIN not bound to account');
    }

    const payload = this.buildPayload(conclusion, caseRow, actor, input.versionNumber);
    const expectedHash = hashConclusionPayload(payload);
    if (expectedHash !== input.contentHash) {
      throw new BadRequestException('Content hash mismatch — draft changed or stale challenge');
    }

    const accepted = await this.signing.acceptCms({
      contentHash: expectedHash,
      cmsBase64: input.cmsBase64,
      claimedSignerIin: input.signerIin,
      expectedSignerIinHash: actor.iinHash,
    });
    if (!accepted.ok) {
      throw new BadRequestException(accepted.reason ?? 'Signature rejected');
    }

    const last = await this.prisma.conclusionVersion.findFirst({
      where: { conclusionId: conclusion.id },
      orderBy: { versionNumber: 'desc' },
    });
    const nextVersion = (last?.versionNumber ?? 0) + 1;
    if (nextVersion !== input.versionNumber) {
      throw new BadRequestException('Version number conflict — refresh sign challenge');
    }

    const html = this.renderPrintHtml(payload, {
      signedAt: new Date().toISOString(),
      certSubject: accepted.certSubject,
      contentHash: expectedHash,
    });
    const pdfBuf = await buildConclusionPdf({
      caseId,
      versionNumber: nextVersion,
      authorDisplayName: actor.displayName,
      authorPosition: conclusion.authorPosition,
      complaints: conclusion.complaints,
      anamnesis: conclusion.anamnesis,
      examination: conclusion.examination,
      conclusionText: conclusion.conclusionText,
      recommendations: conclusion.recommendations,
      signedAt: new Date().toISOString(),
      certSubject: accepted.certSubject,
      contentHash: expectedHash,
    });
    const pdfKey = `conclusions/${caseRow.organizationId}/${caseId}/v${nextVersion}.pdf`;
    const htmlKey = `conclusions/${caseRow.organizationId}/${caseId}/v${nextVersion}.html`;
    await this.storage.putArtifactObject(pdfKey, pdfBuf, 'application/pdf');
    await this.storage.putArtifactObject(htmlKey, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');

    const version = await this.prisma.$transaction(async (tx) => {
      const v = await tx.conclusionVersion.create({
        data: {
          conclusionId: conclusion.id,
          versionNumber: nextVersion,
          previousVersionId: last?.id ?? null,
          contentJson: JSON.stringify(payload),
          contentHash: expectedHash,
          signedAt: new Date(),
          cmsSignature: input.cmsBase64,
          signerIinHash: actor.iinHash,
          certSubject: accepted.certSubject ?? null,
          certSerial: accepted.certSerial ?? null,
          signatureAlg: 'CMS/NCALayer',
          // Honest: structural + IIN bind only until NCA_CMS_VERIFY_ENABLED
          verificationOk: Boolean(accepted.cryptoVerified),
          pdfStorageKey: pdfKey,
        },
      });

      await tx.conclusion.update({
        where: { id: conclusion.id },
        data: { status: ConclusionStatus.SIGNED },
      });

      if (caseRow.status === CaseStatus.AWAITING_SIGNATURE) {
        await tx.case.update({
          where: { id: caseId },
          data: { status: CaseStatus.AWAITING_PATIENT_DELIVERY },
        });
        await tx.caseStatusHistory.create({
          data: {
            caseId,
            fromStatus: CaseStatus.AWAITING_SIGNATURE,
            toStatus: CaseStatus.AWAITING_PATIENT_DELIVERY,
            reason: 'conclusion_signed',
            actorId: actor.id,
          },
        });
      }

      return v;
    });

    await this.notifications.enqueue({
      organizationId: caseRow.organizationId,
      caseId,
      channel: 'stub',
      templateKey: 'conclusion_signed_for_patient',
      recipientRef: caseRow.patientId,
      payloadMeta: { conclusionId: conclusion.id, versionId: version.id },
    });

    await this.audit.logAccess({
      userId: actor.id,
      organizationId: caseRow.organizationId,
      objectType: 'conclusion',
      objectId: conclusion.id,
      action: 'signed',
    });

    // Kick MIS / manual bridge outbox (idempotent)
    try {
      await this.mis.enqueueCaseCompleted(caseId, actor.id);
    } catch {
      /* outbox can be retried via POST /mis/cases/:id/enqueue */
    }

    return {
      conclusionId: conclusion.id,
      versionId: version.id,
      versionNumber: version.versionNumber,
      contentHash: version.contentHash,
      signedAt: version.signedAt,
      documentKey: pdfKey,
      caseStatus: CaseStatus.AWAITING_PATIENT_DELIVERY,
    };
  }

  /**
   * Dev/pilot helper when NCALayer is not installed: ALLOW_BOOTSTRAP only.
   * Still requires real consultant IIN match (TZ 9.3.3).
   */
  async applyDevSignature(actor: AuthUser, caseId: string, signerIin: string) {
    if (process.env.ALLOW_BOOTSTRAP !== 'true') {
      throw new ForbiddenException('Dev signature disabled');
    }
    const challenge = await this.prepareSignChallenge(actor, caseId);
    const cmsBase64 = Buffer.from(
      `DEV-CMS|hash=${challenge.contentHash}|iin=${signerIin}|ts=${Date.now()}`,
      'utf8',
    ).toString('base64');
    return this.applySignature(actor, caseId, {
      cmsBase64,
      signerIin,
      contentHash: challenge.contentHash,
      versionNumber: challenge.versionNumber,
    });
  }

  async documentUrl(actor: AuthUser, caseId: string) {
    await this.requireCaseAccess(actor, caseId);
    const conclusion = await this.prisma.conclusion.findUnique({
      where: { caseId },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    const latest = conclusion?.versions[0];
    if (!latest?.pdfStorageKey) throw new NotFoundException('Signed document not found');
    const url = await this.storage.signedGetUrl('artifacts', latest.pdfStorageKey, 300);
    return { url, versionNumber: latest.versionNumber, contentHash: latest.contentHash };
  }

  async patientGetConclusion(actor: AuthUser, caseId: string) {
    const caseRow = await this.requirePatientCase(actor, caseId);
    const conclusion = await this.prisma.conclusion.findUnique({
      where: { caseId },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    if (!conclusion || conclusion.status === ConclusionStatus.DRAFT || conclusion.status === ConclusionStatus.READY_TO_SIGN) {
      return { available: false as const, caseStatus: caseRow.status };
    }
    const latest = conclusion.versions[0];
    let documentUrl: string | null = null;
    if (latest?.pdfStorageKey) {
      documentUrl = await this.storage.signedGetUrl('artifacts', latest.pdfStorageKey, 300);
    }
    return {
      available: true as const,
      caseStatus: caseRow.status,
      status: conclusion.status,
      conclusionText: conclusion.conclusionText,
      recommendations: conclusion.recommendations,
      authorPosition: conclusion.authorPosition,
      signedAt: latest?.signedAt ?? null,
      contentHash: latest?.contentHash ?? null,
      versionNumber: latest?.versionNumber ?? null,
      documentUrl,
      deliveredAt: conclusion.deliveredAt,
    };
  }

  async patientConfirmDelivery(actor: AuthUser, caseId: string) {
    const caseRow = await this.requirePatientCase(actor, caseId);
    if (caseRow.status !== CaseStatus.AWAITING_PATIENT_DELIVERY) {
      throw new BadRequestException(`Case status ${caseRow.status} does not allow delivery confirm`);
    }
    const conclusion = await this.prisma.conclusion.findUnique({ where: { caseId } });
    if (!conclusion || conclusion.status !== ConclusionStatus.SIGNED) {
      throw new BadRequestException('Signed conclusion required');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.conclusion.update({
        where: { id: conclusion.id },
        data: { status: ConclusionStatus.DELIVERED, deliveredAt: new Date() },
      });
      await tx.case.update({
        where: { id: caseId },
        data: { status: CaseStatus.CLOSED },
      });
      await tx.caseStatusHistory.create({
        data: {
          caseId,
          fromStatus: CaseStatus.AWAITING_PATIENT_DELIVERY,
          toStatus: CaseStatus.CLOSED,
          reason: 'patient_received_conclusion',
          actorId: actor.id,
        },
      });
    });

    await this.audit.logAccess({
      userId: actor.id,
      role: MembershipRole.PATIENT,
      organizationId: caseRow.organizationId,
      objectType: 'conclusion',
      objectId: conclusion.id,
      action: 'patient_delivery_confirm',
    });

    await this.notifications.enqueue({
      organizationId: caseRow.organizationId,
      caseId,
      channel: 'web',
      templateKey: 'case_closed_after_delivery',
      recipientRef: conclusion.authorUserId,
    });

    try {
      await this.mis.enqueueCaseCompleted(caseId, actor.id);
    } catch {
      /* retry via MIS enqueue */
    }

    return { ok: true, caseStatus: CaseStatus.CLOSED };
  }

  /** Reminder / escalation stubs for overdue signing (TZ queue) */
  async enqueueSigningReminders(organizationId: string) {
    const overdue = await this.prisma.conclusion.findMany({
      where: {
        organizationId,
        status: ConclusionStatus.READY_TO_SIGN,
        updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    for (const c of overdue) {
      await this.notifications.enqueue({
        organizationId,
        caseId: c.caseId,
        channel: 'web',
        templateKey: 'conclusion_sign_reminder',
        recipientRef: c.authorUserId,
        payloadMeta: { conclusionId: c.id, hoursOverdue: 24 },
      });
    }
    return { reminded: overdue.length };
  }

  private buildPayload(
    conclusion: {
      id: string;
      caseId: string;
      organizationId: string;
      complaints: string;
      anamnesis: string;
      examination: string;
      conclusionText: string;
      recommendations: string;
      authorUserId: string;
      authorPosition: string;
      updatedAt: Date;
    },
    _caseRow: { id: string },
    actor: AuthUser,
    versionNumber: number,
  ): ConclusionSignPayload {
    return {
      conclusionId: conclusion.id,
      caseId: conclusion.caseId,
      organizationId: conclusion.organizationId,
      versionNumber,
      complaints: conclusion.complaints,
      anamnesis: conclusion.anamnesis,
      examination: conclusion.examination,
      conclusionText: conclusion.conclusionText,
      recommendations: conclusion.recommendations,
      authorUserId: conclusion.authorUserId,
      authorDisplayName: actor.displayName,
      authorPosition: conclusion.authorPosition,
      authoredAt: conclusion.updatedAt.toISOString(),
    };
  }

  private renderPrintHtml(
    payload: ConclusionSignPayload,
    meta: { signedAt: string; certSubject?: string; contentHash: string },
  ) {
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <title>Заключение ДМУ — Miru Remote</title>
  <style>
    body { font-family: "Times New Roman", serif; max-width: 720px; margin: 2rem auto; color: #111; }
    h1 { font-size: 1.25rem; }
    h2 { font-size: 1rem; margin-top: 1.25rem; }
    .meta { color: #444; font-size: 0.9rem; }
    pre { white-space: pre-wrap; font-family: inherit; }
  </style>
</head>
<body>
  <h1>Заключение дистанционной медицинской услуги</h1>
  <p class="meta">Случай: ${esc(payload.caseId)} · версия ${payload.versionNumber}</p>
  <p class="meta">Врач: ${esc(payload.authorDisplayName)} · ${esc(payload.authorPosition || '—')}</p>
  <p class="meta">Подписано: ${esc(meta.signedAt)} · ${esc(meta.certSubject ?? '')}</p>
  <p class="meta">SHA-256: ${esc(meta.contentHash)}</p>
  <h2>Жалобы</h2><pre>${esc(payload.complaints)}</pre>
  <h2>Анамнез</h2><pre>${esc(payload.anamnesis)}</pre>
  <h2>Осмотр / данные</h2><pre>${esc(payload.examination)}</pre>
  <h2>Заключение</h2><pre>${esc(payload.conclusionText)}</pre>
  <h2>Рекомендации</h2><pre>${esc(payload.recommendations)}</pre>
  <p class="meta">Документ сформирован Miru Remote. Печать → PDF в браузере.</p>
</body>
</html>`;
  }

  private assertRequiredFields(c: {
    complaints: string;
    anamnesis: string;
    examination: string;
    conclusionText: string;
    recommendations: string;
  }) {
    const missing = (
      [
        ['complaints', c.complaints],
        ['anamnesis', c.anamnesis],
        ['examination', c.examination],
        ['conclusionText', c.conclusionText],
        ['recommendations', c.recommendations],
      ] as const
    ).filter(([, v]) => !v?.trim());
    if (missing.length) {
      throw new BadRequestException(
        `Required conclusion fields empty (TZ 6.4.2): ${missing.map(([k]) => k).join(', ')}`,
      );
    }
  }

  private async transitionCase(
    actor: AuthUser,
    caseRow: { id: string; status: CaseStatus; organizationId: string; acceptances?: unknown[] },
    toStatus: CaseStatus,
    reason: string,
  ) {
    const hasConsent = true;
    const error = canTransitionCaseStatus(
      caseRow.status as SharedStatus,
      toStatus as SharedStatus,
      { hasConsent },
    );
    if (error) throw new BadRequestException(error);

    await this.prisma.$transaction(async (tx) => {
      await tx.case.update({ where: { id: caseRow.id }, data: { status: toStatus } });
      await tx.caseStatusHistory.create({
        data: {
          caseId: caseRow.id,
          fromStatus: caseRow.status,
          toStatus,
          reason,
          actorId: actor.id,
        },
      });
    });
  }

  private serialize(row: {
    id: string;
    organizationId: string;
    caseId: string;
    authorUserId: string;
    status: ConclusionStatus;
    complaints: string;
    anamnesis: string;
    examination: string;
    conclusionText: string;
    recommendations: string;
    authorPosition: string;
    deliveredAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      caseId: row.caseId,
      authorUserId: row.authorUserId,
      status: row.status,
      complaints: row.complaints,
      anamnesis: row.anamnesis,
      examination: row.examination,
      conclusionText: row.conclusionText,
      recommendations: row.recommendations,
      authorPosition: row.authorPosition,
      deliveredAt: row.deliveredAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async requireCaseAccess(actor: AuthUser, caseId: string) {
    const caseRow = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { participants: true, acceptances: true },
    });
    if (!caseRow) throw new NotFoundException('Case not found');
    this.assertOrgMembership(actor, caseRow.organizationId);

    const isAuditor = actor.memberships.some(
      (m) => m.organizationId === caseRow.organizationId && m.role === MembershipRole.AUDITOR,
    );
    const isOrgAdmin = actor.memberships.some(
      (m) => m.organizationId === caseRow.organizationId && m.role === MembershipRole.ORG_ADMIN,
    );
    const isParticipant = caseRow.participants.some((p) => p.userId === actor.id);
    const clinical = actor.memberships.some(
      (m) =>
        m.organizationId === caseRow.organizationId &&
        (
          [
            MembershipRole.CONSULTANT,
            MembershipRole.REGISTRAR,
            MembershipRole.DEPARTMENT_HEAD,
            MembershipRole.AMBULATORY_WORKER,
          ] as MembershipRole[]
        ).includes(m.role),
    );
    if (!isParticipant && !isAuditor && !isOrgAdmin && !clinical) {
      throw new ForbiddenException('No object-level access to this case');
    }
    return caseRow;
  }

  private async requirePatientCase(actor: AuthUser, caseId: string) {
    if (!actor.memberships.some((m) => m.role === MembershipRole.PATIENT) || !actor.iinHash) {
      throw new ForbiddenException('Patient role required');
    }
    const caseRow = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { patient: true },
    });
    if (!caseRow) throw new NotFoundException('Case not found');
    if (caseRow.patient.iinHash !== actor.iinHash) {
      throw new ForbiddenException('Not your case');
    }
    return caseRow;
  }

  private assertOrgMembership(actor: AuthUser, organizationId: string) {
    const ok = actor.memberships.some((m) => m.organizationId === organizationId);
    if (!ok) throw new ForbiddenException('No membership in organization');
  }
}
