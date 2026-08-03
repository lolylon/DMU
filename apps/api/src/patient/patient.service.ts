import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CaseStatus, MembershipRole, SlotStatus, AppointmentStatus, CaseMode } from '@prisma/client';
import { randomInt } from 'crypto';
import { isValidIin, TIMEZONE } from '@miru/shared';
import { PrismaService } from '../prisma/prisma.service';
import { hashIin, sha256 } from '../common/crypto';
import { IdentityService } from '../identity/identity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { AuthUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { createHash } from 'crypto';

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_SECONDS = 60;

function contentHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

@Injectable()
export class PatientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly notifications: NotificationsService,
    private readonly scheduling: SchedulingService,
    private readonly audit: AuditService,
  ) {}

  /**
   * TZ 7.1.1 — IIN + confirmation code.
   * Anti-enumeration: same response whether patient exists or not (FrontDesk 7.1.5 spirit).
   */
  async requestCode(iin: string, ip?: string) {
    if (!isValidIin(iin)) {
      throw new BadRequestException('Invalid IIN checksum');
    }
    const iinHashValue = hashIin(iin);

    const recent = await this.prisma.patientAuthChallenge.findFirst({
      where: {
        iinHash: iinHashValue,
        createdAt: { gte: new Date(Date.now() - RATE_LIMIT_SECONDS * 1000) },
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    // In prod-like mode block rapid re-issue; bootstrap/dev allows refresh (UI double-submit safe with invalidate below)
    if (recent && process.env.ALLOW_BOOTSTRAP !== 'true') {
      throw new BadRequestException('Code already requested; wait before retry');
    }

    const patients = await this.prisma.patient.findMany({ where: { iinHash: iinHashValue } });
    const code = String(randomInt(100000, 999999));

    // Only one active challenge per IIN — avoid race (double submit) showing stale debugCode
    await this.prisma.patientAuthChallenge.updateMany({
      where: { iinHash: iinHashValue, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const challenge = await this.prisma.patientAuthChallenge.create({
      data: {
        iinHash: iinHashValue,
        codeHash: sha256(code),
        expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
      },
    });

    if (patients.length > 0) {
      const withTg = patients.find((p) => p.telegramChatId);
      const phone = patients.find((p) => p.phone)?.phone;
      if (withTg?.telegramChatId && process.env.TELEGRAM_BOT_TOKEN) {
        await this.notifications.enqueue({
          organizationId: patients[0]!.organizationId,
          channel: 'telegram',
          templateKey: 'patient_auth_code',
          recipientRef: withTg.telegramChatId,
          payloadMeta: { challengeId: challenge.id },
          messageText: `Miru: код входа ${code}. Действует ${CODE_TTL_MINUTES} мин.`,
        });
      } else if (phone) {
        await this.notifications.enqueue({
          organizationId: patients[0]!.organizationId,
          channel: 'sms',
          templateKey: 'patient_auth_code',
          recipientRef: phone,
          payloadMeta: { challengeId: challenge.id },
          messageText: `Miru: kod ${code}`,
        });
      } else {
        await this.notifications.enqueue({
          organizationId: patients[0]!.organizationId,
          channel: 'stub',
          templateKey: 'patient_auth_code',
          recipientRef: `patient:${iinHashValue.slice(0, 8)}`,
          payloadMeta: { challengeId: challenge.id },
        });
      }
    }

    const response: {
      ok: true;
      expiresAt: Date;
      message: string;
      debugCode?: string;
    } = {
      ok: true,
      expiresAt: challenge.expiresAt,
      message: 'If the IIN is registered, a confirmation code was sent',
    };

    // Local-only aid — never expose OTP over a public / production API (NFR 12.5)
    if (
      process.env.ALLOW_BOOTSTRAP === 'true' &&
      process.env.NODE_ENV !== 'production' &&
      patients.length > 0
    ) {
      response.debugCode = code;
    }

    await this.audit.logAccess({
      action: 'patient_code_requested',
      objectType: 'patient_auth',
      objectId: iinHashValue.slice(0, 16),
      ip,
    });

    return response;
  }

  async verifyCode(input: {
    iin: string;
    code: string;
    ip?: string;
    userAgent?: string;
    telegramChatId?: string;
  }) {
    if (!isValidIin(input.iin)) {
      throw new BadRequestException('Invalid IIN checksum');
    }
    const iinHashValue = hashIin(input.iin);

    const challenge = await this.prisma.patientAuthChallenge.findFirst({
      where: {
        iinHash: iinHashValue,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge) {
      throw new UnauthorizedException('Invalid or expired code');
    }
    if (challenge.attempts >= MAX_ATTEMPTS) {
      throw new ForbiddenException('Too many attempts');
    }

    if (challenge.codeHash !== sha256(input.code.trim())) {
      await this.prisma.patientAuthChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Invalid or expired code');
    }

    await this.prisma.patientAuthChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    const patients = await this.prisma.patient.findMany({ where: { iinHash: iinHashValue } });
    if (patients.length === 0) {
      // Do not confirm existence difference beyond failed auth after code path
      throw new UnauthorizedException('Invalid or expired code');
    }

    if (input.telegramChatId && /^\d{5,20}$/.test(input.telegramChatId)) {
      await this.prisma.patient.updateMany({
        where: { iinHash: iinHashValue },
        data: { telegramChatId: input.telegramChatId },
      });
    }

    let user = await this.prisma.user.findFirst({
      where: { iinHash: iinHashValue },
      include: { memberships: true },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          iinHash: iinHashValue,
          displayName: patients[0]!.fullName,
          phone: patients[0]!.phone,
          memberships: {
            create: patients.map((p) => ({
              organizationId: p.organizationId,
              role: MembershipRole.PATIENT,
            })),
          },
        },
        include: { memberships: true },
      });
    } else {
      // Ensure PATIENT membership for each org where patient record exists
      for (const p of patients) {
        await this.prisma.membership.upsert({
          where: {
            userId_organizationId_role: {
              userId: user.id,
              organizationId: p.organizationId,
              role: MembershipRole.PATIENT,
            },
          },
          create: {
            userId: user.id,
            organizationId: p.organizationId,
            role: MembershipRole.PATIENT,
          },
          update: {},
        });
      }
      user = await this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { memberships: true },
      });
    }

    const session = await this.identity.issueSession(user.id, input.ip, input.userAgent);
    await this.audit.logAccess({
      userId: user.id,
      action: 'patient_login_success',
      objectType: 'auth',
      objectId: user.id,
      ip: input.ip,
      organizationId: patients[0]?.organizationId,
      role: MembershipRole.PATIENT,
    });

    return {
      accessToken: session.token,
      expiresAt: session.expiresAt,
      user: {
        id: user.id,
        displayName: user.displayName,
        memberships: user.memberships
          .filter((m) => m.role === MembershipRole.PATIENT)
          .map((m) => ({ organizationId: m.organizationId, role: m.role })),
      },
    };
  }

  async listMyCases(actor: AuthUser) {
    this.assertPatient(actor);
    const patients = await this.prisma.patient.findMany({
      where: { iinHash: actor.iinHash! },
      select: { id: true },
    });
    const patientIds = patients.map((p) => p.id);

    const rows = await this.prisma.case.findMany({
      where: { patientId: { in: patientIds } },
      orderBy: { createdAt: 'desc' },
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
      id: r.id,
      organizationId: r.organizationId,
      status: r.status,
      mode: r.mode,
      createdAt: r.createdAt,
      patient: r.patient,
      activeAppointment: r.appointments[0]
        ? {
            id: r.appointments[0].id,
            startsAt: r.appointments[0].slot.startsAt,
            endsAt: r.appointments[0].slot.endsAt,
          }
        : null,
    }));
  }

  async getMyCase(actor: AuthUser, caseId: string) {
    const caseRow = await this.requireOwnCase(actor, caseId);
    await this.audit.logAccess({
      userId: actor.id,
      role: MembershipRole.PATIENT,
      organizationId: caseRow.organizationId,
      objectType: 'case',
      objectId: caseId,
      action: 'patient_view',
    });

    const docs = await this.prisma.consentDocument.findMany({
      where: {
        OR: [{ organizationId: caseRow.organizationId }, { organizationId: null }],
      },
      orderBy: { publishedAt: 'desc' },
    });

    // latest per kind
    const latestByKind = new Map<string, (typeof docs)[0]>();
    for (const d of docs) {
      if (!latestByKind.has(d.kind)) latestByKind.set(d.kind, d);
    }

    return {
      id: caseRow.id,
      organizationId: caseRow.organizationId,
      status: caseRow.status,
      mode: caseRow.mode,
      acceptances: caseRow.acceptances.map((a) => ({
        id: a.id,
        method: a.method,
        acceptedAt: a.acceptedAt,
        contentHash: a.contentHash,
        consentDocumentId: a.consentDocumentId,
      })),
      activeAppointment: caseRow.appointments[0]
        ? {
            id: caseRow.appointments[0].id,
            startsAt: caseRow.appointments[0].slot.startsAt,
            endsAt: caseRow.appointments[0].slot.endsAt,
          }
        : null,
      pendingConsents: [...latestByKind.values()]
        .filter((d) => !caseRow.acceptances.some((a) => a.consentDocumentId === d.id))
        .filter((d) => ['offer', 'dmu_consent', 'pmd_consent'].includes(d.kind))
        .map((d) => ({
          id: d.id,
          kind: d.kind,
          version: d.version,
          language: d.language,
          body: d.body,
          contentHash: d.contentHash,
        })),
    };
  }

  /** TZ 7.1 — Mini App acceptance with hash/time/method */
  async acceptConsent(actor: AuthUser, caseId: string, consentDocumentId: string, deviceId?: string, ip?: string) {
    const caseRow = await this.requireOwnCase(actor, caseId);
    if (caseRow.status !== CaseStatus.AWAITING_CONSENT) {
      throw new BadRequestException(`Consent only in AWAITING_CONSENT, current=${caseRow.status}`);
    }

    const doc = await this.prisma.consentDocument.findUnique({ where: { id: consentDocumentId } });
    if (!doc) throw new NotFoundException('Consent document not found');
    if (doc.contentHash !== contentHash(doc.body)) {
      throw new BadRequestException('Consent document integrity check failed');
    }

    const acceptance = await this.prisma.consentAcceptance.create({
      data: {
        consentDocumentId: doc.id,
        caseId,
        patientId: caseRow.patientId,
        method: 'mini_app',
        acceptedAtTz: TIMEZONE,
        ip,
        deviceId,
        contentHash: doc.contentHash,
      },
    });

    // All required kinds accepted? offer + dmu_consent + pmd_consent
    const required = ['offer', 'dmu_consent', 'pmd_consent'];
    const acceptedDocs = await this.prisma.consentAcceptance.findMany({
      where: { caseId },
      include: { consentDocument: true },
    });
    const acceptedKinds = new Set(acceptedDocs.map((a) => a.consentDocument.kind));
    const allDone = required.every((k) => acceptedKinds.has(k));

    if (allDone) {
      await this.prisma.$transaction(async (tx) => {
        await tx.case.update({
          where: { id: caseId },
          data: { status: CaseStatus.AWAITING_BOOKING },
        });
        await tx.caseStatusHistory.create({
          data: {
            caseId,
            fromStatus: CaseStatus.AWAITING_CONSENT,
            toStatus: CaseStatus.AWAITING_BOOKING,
            actorId: actor.id,
            reason: 'consents_accepted_mini_app',
          },
        });
      });
    }

    return {
      acceptanceId: acceptance.id,
      allRequiredAccepted: allDone,
      status: allDone ? CaseStatus.AWAITING_BOOKING : caseRow.status,
    };
  }

  async listSlotsForCase(actor: AuthUser, caseId: string, fromIso: string, toIso: string) {
    const caseRow = await this.requireOwnCase(actor, caseId);
    if (caseRow.status !== CaseStatus.AWAITING_BOOKING && caseRow.status !== CaseStatus.RESCHEDULED) {
      throw new BadRequestException('Slots available only when awaiting booking');
    }

    return this.prisma.slot.findMany({
      where: {
        organizationId: caseRow.organizationId,
        status: SlotStatus.FREE,
        startsAt: { gte: new Date(fromIso), lte: new Date(toIso) },
      },
      orderBy: { startsAt: 'asc' },
      take: 100,
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        consultantUserId: true,
      },
    });
  }

  async bookSlot(actor: AuthUser, caseId: string, slotId: string) {
    await this.requireOwnCase(actor, caseId);
    return this.scheduling.bookSlot(actor, { caseId, slotId });
  }

  async cancelAppointment(actor: AuthUser, appointmentId: string, reason: string) {
    this.assertPatient(actor);
    return this.scheduling.cancelAppointment(actor, appointmentId, reason);
  }

  /** Start DMU case from public catalog (Mini App) */
  async startFromCatalog(
    actor: AuthUser,
    input: { organizationId: string; profileCode: string; patientFullName: string },
  ) {
    this.assertPatient(actor);
    const iinHash = actor.iinHash!;
    const name = input.patientFullName.trim();
    if (name.length < 2) {
      throw new BadRequestException('Укажите ФИО пациента');
    }

    const org = await this.prisma.organization.findFirst({
      where: { id: input.organizationId, catalogPublic: true },
    });
    if (!org) {
      throw new NotFoundException('Organization not in public catalog');
    }

    const offer = await this.prisma.catalogOffer.findFirst({
      where: {
        organizationId: input.organizationId,
        profileCode: input.profileCode,
        active: true,
      },
    });
    if (!offer) {
      throw new BadRequestException('Услуга не найдена в витрине');
    }

    const sibling = await this.prisma.patient.findFirst({
      where: { iinHash, telegramChatId: { not: null } },
      select: { telegramChatId: true, phone: true },
    });

    let patient = await this.prisma.patient.findUnique({
      where: {
        organizationId_iinHash: { organizationId: input.organizationId, iinHash },
      },
    });
    if (!patient) {
      patient = await this.prisma.patient.create({
        data: {
          organizationId: input.organizationId,
          iinHash,
          fullName: name,
          phone: sibling?.phone ?? null,
          telegramChatId: sibling?.telegramChatId ?? null,
        },
      });
    } else {
      patient = await this.prisma.patient.update({
        where: { id: patient.id },
        data: {
          fullName: name,
          ...(sibling?.telegramChatId && !patient.telegramChatId
            ? { telegramChatId: sibling.telegramChatId }
            : {}),
        },
      });
    }

    await this.prisma.membership.upsert({
      where: {
        userId_organizationId_role: {
          userId: actor.id,
          organizationId: input.organizationId,
          role: MembershipRole.PATIENT,
        },
      },
      create: {
        userId: actor.id,
        organizationId: input.organizationId,
        role: MembershipRole.PATIENT,
      },
      update: {},
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const caseRow = await tx.case.create({
        data: {
          organizationId: input.organizationId,
          patientId: patient.id,
          mode: CaseMode.REALTIME,
          status: CaseStatus.CREATED,
          profileCode: input.profileCode,
          participants: {
            create: { userId: actor.id, role: MembershipRole.PATIENT },
          },
        },
      });
      await tx.caseStatusHistory.create({
        data: {
          caseId: caseRow.id,
          fromStatus: null,
          toStatus: CaseStatus.CREATED,
          actorId: actor.id,
          reason: 'miniapp_catalog_start',
        },
      });
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
          reason: 'awaiting_consent',
        },
      });
      return awaiting;
    });

    return this.getMyCase(actor, created.id);
  }

  async bindTelegramChat(actor: AuthUser, telegramChatId: string) {
    this.assertPatient(actor);
    if (!/^\d{5,20}$/.test(telegramChatId)) {
      throw new BadRequestException('Invalid telegramChatId');
    }
    const result = await this.prisma.patient.updateMany({
      where: { iinHash: actor.iinHash! },
      data: { telegramChatId },
    });
    return { ok: true, updated: result.count };
  }

  private assertPatient(actor: AuthUser) {
    const isPatient = actor.memberships.some((m) => m.role === MembershipRole.PATIENT);
    if (!isPatient || !actor.iinHash) {
      throw new ForbiddenException('Patient role required');
    }
  }

  private async requireOwnCase(actor: AuthUser, caseId: string) {
    this.assertPatient(actor);
    const caseRow = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: {
        patient: true,
        acceptances: true,
        appointments: {
          where: { status: AppointmentStatus.ACTIVE },
          include: { slot: true },
          take: 1,
        },
        participants: true,
      },
    });
    if (!caseRow) throw new NotFoundException('Case not found');
    if (caseRow.patient.iinHash !== actor.iinHash) {
      throw new ForbiddenException('No access to this case');
    }
    return caseRow;
  }
}
