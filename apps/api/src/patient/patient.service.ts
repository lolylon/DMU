import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CaseStatus, MembershipRole, SlotStatus, AppointmentStatus } from '@prisma/client';
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
    if (recent) {
      throw new BadRequestException('Code already requested; wait before retry');
    }

    const patients = await this.prisma.patient.findMany({ where: { iinHash: iinHashValue } });
    const code = String(randomInt(100000, 999999));
    const challenge = await this.prisma.patientAuthChallenge.create({
      data: {
        iinHash: iinHashValue,
        codeHash: sha256(code),
        expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
      },
    });

    if (patients.length > 0) {
      const phone = patients.find((p) => p.phone)?.phone ?? `patient:${iinHashValue.slice(0, 8)}`;
      await this.notifications.enqueue({
        organizationId: patients[0]!.organizationId,
        channel: 'sms',
        templateKey: 'patient_auth_code',
        recipientRef: phone,
        payloadMeta: { challengeId: challenge.id },
      });
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

    // Dev-only aid — never in production (NFR 12.5)
    if (process.env.ALLOW_BOOTSTRAP === 'true' && patients.length > 0) {
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

  async verifyCode(input: { iin: string; code: string; ip?: string; userAgent?: string }) {
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

    if (challenge.codeHash !== sha256(input.code)) {
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
