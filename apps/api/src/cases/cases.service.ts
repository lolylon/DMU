import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CaseMode, CaseStatus, MembershipRole, AppointmentStatus } from '@prisma/client';
import { canTransitionCaseStatus, type CaseStatus as SharedStatus } from '@miru/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators';
import { hashIin } from '../common/crypto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * TZ 6.1.4 — cases are never deleted; only cancelled with mandatory reason.
   */
  async createCase(actor: AuthUser, input: {
    organizationId: string;
    patientIin: string;
    patientFullName: string;
    mode?: CaseMode;
    profileCode?: string;
  }) {
    this.assertOrgMembership(actor, input.organizationId);

    const patient = await this.prisma.patient.upsert({
      where: {
        organizationId_iinHash: {
          organizationId: input.organizationId,
          iinHash: hashIin(input.patientIin),
        },
      },
      create: {
        organizationId: input.organizationId,
        iinHash: hashIin(input.patientIin),
        fullName: input.patientFullName,
      },
      update: {
        fullName: input.patientFullName,
      },
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const caseRow = await tx.case.create({
        data: {
          organizationId: input.organizationId,
          patientId: patient.id,
          mode: input.mode ?? CaseMode.REALTIME,
          status: CaseStatus.CREATED,
          profileCode: input.profileCode,
          participants: {
            create: {
              userId: actor.id,
              role: this.primaryOrgRole(actor, input.organizationId),
            },
          },
        },
      });

      await tx.caseStatusHistory.create({
        data: {
          caseId: caseRow.id,
          fromStatus: null,
          toStatus: CaseStatus.CREATED,
          actorId: actor.id,
          reason: 'case_created',
        },
      });

      // Move to awaiting consent (main flow next step)
      const awaiting = await tx.case.update({
        where: { id: caseRow.id },
        data: { status: CaseStatus.AWAITING_CONSENT },
      });
      await tx.caseStatusHistory.create({
        data: {
          caseId: caseRow.id,
          fromStatus: CaseStatus.CREATED,
          toStatus: CaseStatus.AWAITING_CONSENT,
          actorId: actor.id,
        },
      });

      return awaiting;
    });

    if (input.profileCode) {
      await this.prisma.profileQueueItem.upsert({
        where: { caseId: created.id },
        create: {
          organizationId: input.organizationId,
          profileCode: input.profileCode,
          caseId: created.id,
          status: 'PENDING',
        },
        update: {},
      });
    }

    await this.audit.logAccess({
      userId: actor.id,
      role: String(this.primaryOrgRole(actor, input.organizationId)),
      organizationId: input.organizationId,
      objectType: 'case',
      objectId: created.id,
      action: 'create',
    });

    return this.sanitizeCase(created);
  }

  async listCases(actor: AuthUser, organizationId: string) {
    this.assertOrgMembership(actor, organizationId);

    const isBroad =
      actor.memberships.some(
        (m) =>
          m.organizationId === organizationId &&
          (
            [
              MembershipRole.REGISTRAR,
              MembershipRole.DEPARTMENT_HEAD,
              MembershipRole.ORG_ADMIN,
              MembershipRole.AUDITOR,
            ] as MembershipRole[]
          ).includes(m.role),
      );

    const rows = await this.prisma.case.findMany({
      where: {
        organizationId,
        ...(isBroad
          ? {}
          : {
              OR: [
                { participants: { some: { userId: actor.id } } },
                {
                  appointments: {
                    some: {
                      status: AppointmentStatus.ACTIVE,
                      slot: { consultantUserId: actor.id },
                    },
                  },
                },
              ],
            }),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        patient: { select: { id: true, fullName: true } },
        appointments: {
          where: { status: AppointmentStatus.ACTIVE },
          include: { slot: true },
          take: 1,
        },
      },
    });
    return rows.map((r) => ({
      ...this.sanitizeCase(r),
      patient: r.patient,
      activeAppointment: r.appointments[0]
        ? {
            id: r.appointments[0].id,
            startsAt: r.appointments[0].slot.startsAt,
            endsAt: r.appointments[0].slot.endsAt,
            consultantUserId: r.appointments[0].slot.consultantUserId,
          }
        : null,
    }));
  }

  async getCase(actor: AuthUser, caseId: string) {
    const caseRow = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: {
        statusHistory: { orderBy: { createdAt: 'asc' } },
        participants: true,
        patient: { select: { id: true, fullName: true, organizationId: true } },
        appointments: {
          where: { status: AppointmentStatus.ACTIVE },
          include: { slot: true },
          take: 1,
        },
      },
    });
    if (!caseRow) throw new NotFoundException('Case not found');

    await this.assertCanAccessCase(actor, caseRow);

    return {
      ...this.sanitizeCase(caseRow),
      patient: {
        id: caseRow.patient.id,
        fullName: caseRow.patient.fullName,
      },
      statusHistory: caseRow.statusHistory,
      participants: caseRow.participants,
      activeAppointment: caseRow.appointments[0]
        ? {
            id: caseRow.appointments[0].id,
            startsAt: caseRow.appointments[0].slot.startsAt,
            endsAt: caseRow.appointments[0].slot.endsAt,
            consultantUserId: caseRow.appointments[0].slot.consultantUserId,
          }
        : null,
    };
  }

  async transition(actor: AuthUser, caseId: string, toStatus: CaseStatus, reason?: string) {
    const caseRow = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { acceptances: true, participants: true },
    });
    if (!caseRow) throw new NotFoundException('Case not found');
    await this.assertCanAccessCase(actor, caseRow);

    if (toStatus === CaseStatus.CANCELLED && !reason?.trim()) {
      throw new BadRequestException('Cancellation reason is mandatory (TZ 6.1.4)');
    }

    const hasConsent = caseRow.acceptances.length > 0;
    const error = canTransitionCaseStatus(
      caseRow.status as SharedStatus,
      toStatus as SharedStatus,
      { hasConsent },
    );
    if (error) throw new BadRequestException(error);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.case.update({
        where: { id: caseId },
        data: {
          status: toStatus,
          closeReason: toStatus === CaseStatus.CANCELLED ? reason : caseRow.closeReason,
        },
      });
      await tx.caseStatusHistory.create({
        data: {
          caseId,
          fromStatus: caseRow.status,
          toStatus,
          reason: reason ?? null,
          actorId: actor.id,
        },
      });
      return row;
    });

    await this.audit.logAccess({
      userId: actor.id,
      organizationId: caseRow.organizationId,
      objectType: 'case',
      objectId: caseId,
      action: `status_${toStatus}`,
    });

    return this.sanitizeCase(updated);
  }

  /**
   * Scenario B — add ambulatory worker / second clinician to case (object-level).
   */
  async addParticipant(
    actor: AuthUser,
    caseId: string,
    input: { userId: string; role: MembershipRole },
  ) {
    const caseRow = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { participants: true },
    });
    if (!caseRow) throw new NotFoundException('Case not found');
    await this.assertCanAccessCase(actor, caseRow);

    const allowedRoles: MembershipRole[] = [
      MembershipRole.AMBULATORY_WORKER,
      MembershipRole.CONSULTANT,
      MembershipRole.DEPARTMENT_HEAD,
    ];
    if (!allowedRoles.includes(input.role)) {
      throw new BadRequestException('Role not allowed as case participant');
    }

    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: input.userId,
        organizationId: caseRow.organizationId,
        role: input.role,
      },
    });
    if (!membership) {
      throw new BadRequestException('User has no matching membership in this MO');
    }

    const row = await this.prisma.caseParticipant.upsert({
      where: {
        caseId_userId_role: {
          caseId,
          userId: input.userId,
          role: input.role,
        },
      },
      create: { caseId, userId: input.userId, role: input.role },
      update: {},
    });

    await this.audit.logAccess({
      userId: actor.id,
      organizationId: caseRow.organizationId,
      objectType: 'case',
      objectId: caseId,
      action: 'participant_add',
    });

    return row;
  }

  /**
   * Async DMU: skip live session — move to conclusion after materials ready (TZ W2).
   */
  async submitAsyncForConclusion(actor: AuthUser, caseId: string) {
    const caseRow = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { participants: true, acceptances: true },
    });
    if (!caseRow) throw new NotFoundException('Case not found');
    await this.assertCanAccessCase(actor, caseRow);
    if (caseRow.mode !== CaseMode.ASYNC) {
      throw new BadRequestException('Case is not ASYNC mode');
    }
    const allowedAsyncFrom: CaseStatus[] = [
      CaseStatus.AWAITING_CONSENT,
      CaseStatus.AWAITING_BOOKING,
      CaseStatus.BOOKED,
      CaseStatus.IN_SESSION,
    ];
    if (!allowedAsyncFrom.includes(caseRow.status)) {
      throw new BadRequestException(`Cannot submit async from status ${caseRow.status}`);
    }
    if (caseRow.acceptances.length === 0) {
      throw new BadRequestException('Consent required before async conclusion path');
    }

    const from = caseRow.status;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.case.update({
        where: { id: caseId },
        data: { status: CaseStatus.AWAITING_CONCLUSION },
      });
      await tx.caseStatusHistory.create({
        data: {
          caseId,
          fromStatus: from,
          toStatus: CaseStatus.AWAITING_CONCLUSION,
          reason: 'async_materials_ready',
          actorId: actor.id,
        },
      });
      return row;
    });

    await this.audit.logAccess({
      userId: actor.id,
      organizationId: caseRow.organizationId,
      objectType: 'case',
      objectId: caseId,
      action: 'async_submit_conclusion',
    });

    return this.sanitizeCase(updated);
  }

  private sanitizeCase(caseRow: {
    id: string;
    organizationId: string;
    patientId: string;
    mode: CaseMode;
    status: CaseStatus;
    profileCode: string | null;
    closeReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: caseRow.id,
      organizationId: caseRow.organizationId,
      patientId: caseRow.patientId,
      mode: caseRow.mode,
      status: caseRow.status,
      profileCode: caseRow.profileCode,
      closeReason: caseRow.closeReason,
      createdAt: caseRow.createdAt,
      updatedAt: caseRow.updatedAt,
    };
  }

  private assertOrgMembership(actor: AuthUser, organizationId: string) {
    const ok = actor.memberships.some((m) => m.organizationId === organizationId);
    if (!ok) throw new ForbiddenException('No membership in organization');
  }

  private async assertCanAccessCase(
    actor: AuthUser,
    caseRow: {
      id?: string;
      organizationId: string;
      participants: { userId: string }[];
    },
  ) {
    this.assertOrgMembership(actor, caseRow.organizationId);

    const isAuditor = actor.memberships.some(
      (m) => m.organizationId === caseRow.organizationId && m.role === MembershipRole.AUDITOR,
    );
    const isOrgAdmin = actor.memberships.some(
      (m) => m.organizationId === caseRow.organizationId && m.role === MembershipRole.ORG_ADMIN,
    );
    const isParticipant = caseRow.participants.some((p) => p.userId === actor.id);

    if (isParticipant || isAuditor || isOrgAdmin) return;

    const registry = actor.memberships.some(
      (m) =>
        m.organizationId === caseRow.organizationId &&
        (m.role === MembershipRole.REGISTRAR || m.role === MembershipRole.DEPARTMENT_HEAD),
    );
    if (registry) return;

    // Assigned consultant via active appointment
    if (caseRow.id) {
      const assigned = await this.prisma.appointment.findFirst({
        where: {
          caseId: caseRow.id,
          status: AppointmentStatus.ACTIVE,
          slot: { consultantUserId: actor.id },
        },
      });
      if (assigned) return;
    }

    throw new ForbiddenException('No object-level access to this case');
  }

  private primaryOrgRole(actor: AuthUser, organizationId: string): MembershipRole {
    const m = actor.memberships.find((x) => x.organizationId === organizationId);
    return m?.role ?? MembershipRole.CONSULTANT;
  }
}
