import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CaseStatus, MembershipRole, MisOutboxStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import {
  DamumedAdapter,
  ManualBridgeAdapter,
  MockMisAdapter,
  ZhetysuAdapter,
} from './mis.adapters';
import type { MisPort } from './mis.port';

@Injectable()
export class MisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly manual: ManualBridgeAdapter,
    private readonly mock: MockMisAdapter,
    private readonly zhetysu: ZhetysuAdapter,
    private readonly damumed: DamumedAdapter,
  ) {}

  resolveAdapter(misMode: string): MisPort {
    switch (misMode) {
      case 'mock':
        return this.mock;
      case 'zhetysu':
        return this.zhetysu;
      case 'damumed':
        return this.damumed;
      case 'manual':
      default:
        return this.manual;
    }
  }

  /**
   * Enqueue + attempt push after clinical completion (idempotent).
   * Called when case reaches AWAITING_PATIENT_DELIVERY or CLOSED.
   */
  async enqueueCaseCompleted(caseId: string, actorId?: string) {
    const caseRow = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { organization: true, conclusion: true },
    });
    if (!caseRow) throw new NotFoundException('Case not found');

    const idempotencyKey = `case_completed:${caseId}`;
    const existing = await this.prisma.misOutbox.findUnique({ where: { idempotencyKey } });
    if (existing && (existing.status === MisOutboxStatus.SENT || existing.status === MisOutboxStatus.MANUAL_DONE)) {
      return existing;
    }

    const payload = {
      caseId: caseRow.id,
      organizationId: caseRow.organizationId,
      status: caseRow.status,
      profileCode: caseRow.profileCode,
      closedAt: new Date().toISOString(),
    };

    const outbox =
      existing ??
      (await this.prisma.misOutbox.create({
        data: {
          organizationId: caseRow.organizationId,
          caseId,
          eventType: 'case_completed',
          payloadJson: JSON.stringify(payload),
          status: MisOutboxStatus.PENDING,
          idempotencyKey,
        },
      }));

    await this.prisma.manualBridgeEntry.upsert({
      where: { caseId },
      create: {
        organizationId: caseRow.organizationId,
        caseId,
        renderedAt: new Date(),
      },
      update: {
        renderedAt: new Date(),
      },
    });

    const adapter = this.resolveAdapter(caseRow.organization.misMode);
    const result = await adapter.pushCaseCompleted(payload);

    const nextStatus: MisOutboxStatus = result.requiresManual
      ? MisOutboxStatus.MANUAL_PENDING
      : result.ok
        ? MisOutboxStatus.SENT
        : MisOutboxStatus.FAILED;

    const updated = await this.prisma.misOutbox.update({
      where: { id: outbox.id },
      data: {
        status: nextStatus,
        externalRef: result.externalRef ?? outbox.externalRef,
        attempts: { increment: 1 },
        lastError: result.error ?? null,
        payloadJson: JSON.stringify(payload),
      },
    });

    if (result.ok && !result.requiresManual) {
      await this.prisma.manualBridgeEntry.update({
        where: { caseId },
        data: {
          enteredInMis: true,
          enteredInMisAt: new Date(),
          enteredByUserId: actorId ?? null,
          notes: `auto:${adapter.name}:${result.externalRef ?? ''}`,
        },
      });
      await this.prisma.misOutbox.update({
        where: { id: outbox.id },
        data: { status: MisOutboxStatus.SENT },
      });
    }

    return updated;
  }

  async setReferral(actor: AuthUser, caseId: string, referralNumber: string, notes?: string) {
    const caseRow = await this.requireRegistrarCase(actor, caseId);
    if (!referralNumber.trim()) throw new BadRequestException('referralNumber required');

    const entry = await this.prisma.manualBridgeEntry.upsert({
      where: { caseId },
      create: {
        organizationId: caseRow.organizationId,
        caseId,
        referralNumber: referralNumber.trim(),
        notes: notes?.trim() || null,
        renderedAt: caseRow.status === CaseStatus.CLOSED ? new Date() : null,
      },
      update: {
        referralNumber: referralNumber.trim(),
        notes: notes?.trim() || null,
      },
    });

    await this.audit.logAccess({
      userId: actor.id,
      organizationId: caseRow.organizationId,
      objectType: 'manual_bridge',
      objectId: caseId,
      action: 'set_referral',
    });

    return entry;
  }

  async markEnteredInMis(actor: AuthUser, caseId: string) {
    const caseRow = await this.requireRegistrarCase(actor, caseId);
    const entry = await this.prisma.manualBridgeEntry.findUnique({ where: { caseId } });
    if (!entry) throw new NotFoundException('Manual bridge entry not found — set referral first');

    const updated = await this.prisma.manualBridgeEntry.update({
      where: { caseId },
      data: {
        enteredInMis: true,
        enteredInMisAt: new Date(),
        enteredByUserId: actor.id,
      },
    });

    await this.prisma.misOutbox.updateMany({
      where: { caseId, eventType: 'case_completed' },
      data: { status: MisOutboxStatus.MANUAL_DONE, externalRef: entry.referralNumber },
    });

    await this.audit.logAccess({
      userId: actor.id,
      organizationId: caseRow.organizationId,
      objectType: 'manual_bridge',
      objectId: caseId,
      action: 'entered_in_mis',
    });

    return updated;
  }

  /** Daily registry «оказано vs внесено» (TZ 5.2) */
  async dailyRegistry(actor: AuthUser, organizationId: string, dayIso: string) {
    this.assertOrgRole(actor, organizationId, [
      MembershipRole.REGISTRAR,
      MembershipRole.DEPARTMENT_HEAD,
      MembershipRole.ORG_ADMIN,
      MembershipRole.AUDITOR,
    ]);

    const day = new Date(dayIso);
    if (Number.isNaN(day.getTime())) throw new BadRequestException('Invalid day (use YYYY-MM-DD)');
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const end = new Date(start.getTime() + 86400000);

    const rows = await this.prisma.manualBridgeEntry.findMany({
      where: {
        organizationId,
        OR: [
          { renderedAt: { gte: start, lt: end } },
          { enteredInMisAt: { gte: start, lt: end } },
          {
            case: {
              status: { in: [CaseStatus.CLOSED, CaseStatus.AWAITING_PATIENT_DELIVERY] },
              updatedAt: { gte: start, lt: end },
            },
          },
        ],
      },
      include: {
        case: {
          include: { patient: { select: { id: true, fullName: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const rendered = rows.filter((r) => r.renderedAt || r.case.status === CaseStatus.CLOSED);
    const entered = rows.filter((r) => r.enteredInMis);
    const pending = rendered.filter((r) => !r.enteredInMis);

    return {
      day: start.toISOString().slice(0, 10),
      organizationId,
      totals: {
        rendered: rendered.length,
        enteredInMis: entered.length,
        pending: pending.length,
      },
      rows: rows.map((r) => ({
        caseId: r.caseId,
        patientName: r.case.patient.fullName,
        caseStatus: r.case.status,
        referralNumber: r.referralNumber,
        renderedAt: r.renderedAt,
        enteredInMis: r.enteredInMis,
        enteredInMisAt: r.enteredInMisAt,
        notes: r.notes,
      })),
    };
  }

  async orgDashboard(actor: AuthUser, organizationId: string) {
    this.assertOrgRole(actor, organizationId, [
      MembershipRole.DEPARTMENT_HEAD,
      MembershipRole.ORG_ADMIN,
      MembershipRole.REGISTRAR,
      MembershipRole.AUDITOR,
      MembershipRole.CONSULTANT,
    ]);

    const byStatus = await this.prisma.case.groupBy({
      by: ['status'],
      where: { organizationId },
      _count: { _all: true },
    });

    const readyToSign = await this.prisma.conclusion.count({
      where: { organizationId, status: 'READY_TO_SIGN' },
    });

    const pendingMis = await this.prisma.manualBridgeEntry.count({
      where: { organizationId, enteredInMis: false, renderedAt: { not: null } },
    });

    const outboxFailed = await this.prisma.misOutbox.count({
      where: { organizationId, status: MisOutboxStatus.FAILED },
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const closedToday = await this.prisma.case.count({
      where: {
        organizationId,
        status: CaseStatus.CLOSED,
        updatedAt: { gte: todayStart },
      },
    });

    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        id: true,
        nameRu: true,
        misMode: true,
        catalogPublic: true,
        status: true,
      },
    });

    return {
      organization: org,
      casesByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      readyToSign,
      pendingMisEntry: pendingMis,
      outboxFailed,
      closedToday,
      generatedAt: new Date().toISOString(),
      note: 'Minimal org dashboard — full department-head [Ж] deferred per architecture §8',
    };
  }

  async getBridgeForCase(actor: AuthUser, caseId: string) {
    const caseRow = await this.requireRegistrarCase(actor, caseId);
    const entry = await this.prisma.manualBridgeEntry.findUnique({ where: { caseId } });
    const outbox = await this.prisma.misOutbox.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      organizationId: caseRow.organizationId,
      misMode: (
        await this.prisma.organization.findUniqueOrThrow({ where: { id: caseRow.organizationId } })
      ).misMode,
      entry,
      outbox,
    };
  }

  private async requireRegistrarCase(actor: AuthUser, caseId: string) {
    const caseRow = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!caseRow) throw new NotFoundException('Case not found');
    this.assertOrgRole(actor, caseRow.organizationId, [
      MembershipRole.REGISTRAR,
      MembershipRole.DEPARTMENT_HEAD,
      MembershipRole.ORG_ADMIN,
      MembershipRole.CONSULTANT,
    ]);
    return caseRow;
  }

  private assertOrgRole(actor: AuthUser, organizationId: string, roles: MembershipRole[]) {
    const ok = actor.memberships.some(
      (m) => m.organizationId === organizationId && roles.includes(m.role),
    );
    if (!ok) throw new ForbiddenException('Insufficient role for MIS/registry');
  }
}
