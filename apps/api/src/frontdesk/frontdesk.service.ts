import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CaseMode, CaseStatus, MembershipRole, SlotStatus, AppointmentStatus } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PatientService } from '../patient/patient.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators';
import type { KioskContext } from './kiosk.decorators';
import { hashIin } from '../common/crypto';

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Stable pilot kiosk bearer — bootstrap never rotates it (same idea as PILOT_TOTP). */
export const PILOT_KIOSK_TOKEN =
  'miru_pilot_kiosk_token_v1_do_not_use_outside_local_bootstrap______';
export const PILOT_PAIR_CODE = 'PILOT1';

const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function normalizePairCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

function formatPairCode(raw: string): string {
  const n = normalizePairCode(raw);
  if (n.length <= 4) return n;
  return `${n.slice(0, 4)}-${n.slice(4)}`;
}

function randomPairCode(length = 8): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += PAIR_ALPHABET[bytes[i]! % PAIR_ALPHABET.length];
  }
  return formatPairCode(out);
}

function cmpSemver(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number(x) || 0);
  const pb = b.split('.').map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

@Injectable()
export class FrontdeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patient: PatientService,
    private readonly scheduling: SchedulingService,
    private readonly audit: AuditService,
  ) {}

  async registerDevice(
    actor: AuthUser,
    input: {
      organizationId: string;
      label: string;
      emergencyEnabled?: boolean;
      otaChannel?: string;
    },
  ) {
    const allowedRoles: MembershipRole[] = [
      MembershipRole.ORG_ADMIN,
      MembershipRole.TECH_IMPLEMENTATION,
      MembershipRole.PLATFORM_ADMIN,
    ];
    const allowed = actor.memberships.some(
      (m) => m.organizationId === input.organizationId && allowedRoles.includes(m.role),
    );
    if (!allowed) throw new ForbiddenException('Admin role required');

    const placeholderToken = randomBytes(32).toString('hex');
    const deviceCode = `FD-${randomBytes(3).toString('hex').toUpperCase()}`;
    const pairCode = randomPairCode(8);
    const pairExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const device = await this.prisma.kioskDevice.create({
      data: {
        organizationId: input.organizationId,
        label: input.label,
        deviceCode,
        tokenHash: hashToken(placeholderToken),
        pairCodeHash: hashToken(normalizePairCode(pairCode)),
        pairExpiresAt,
        emergencyEnabled: input.emergencyEnabled ?? false,
        otaChannel: input.otaChannel ?? 'pilot',
      },
    });

    await this.audit.logAccess({
      userId: actor.id,
      organizationId: input.organizationId,
      objectType: 'kiosk_device',
      objectId: device.id,
      action: 'register',
    });

    return {
      id: device.id,
      deviceCode: device.deviceCode,
      label: device.label,
      /** Short code for the terminal — prefer this over long tokens */
      pairCode,
      pairExpiresAt,
      howTo:
        'На киоске введите pairCode (или отсканируйте QR на экране привязки). Длинный deviceToken человеку не нужен.',
    };
  }

  /** Exchange short pair code (or legacy long token) for a stored kiosk bearer. */
  async claimPair(input: { code?: string; deviceToken?: string }) {
    const rawCode = input.code?.trim();
    const rawToken = input.deviceToken?.trim();

    if (rawToken && rawToken.length >= 32) {
      const device = await this.prisma.kioskDevice.findUnique({
        where: { tokenHash: hashToken(rawToken) },
      });
      if (!device || !device.enabled) {
        throw new BadRequestException('Неверный deviceToken');
      }
      return {
        ok: true as const,
        deviceId: device.id,
        deviceCode: device.deviceCode,
        label: device.label,
        deviceToken: rawToken,
        mode: 'token' as const,
      };
    }

    if (!rawCode) {
      throw new BadRequestException('Укажите код привязки');
    }

    const normalized = normalizePairCode(rawCode);
    const device = await this.prisma.kioskDevice.findFirst({
      where: { pairCodeHash: hashToken(normalized), enabled: true },
    });
    if (!device) {
      throw new BadRequestException('Неверный или уже использованный код');
    }
    if (device.pairExpiresAt && device.pairExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Срок кода истёк — запросите новый у администратора');
    }

    const deviceToken =
      device.deviceCode === 'FD-PILOT01' ? PILOT_KIOSK_TOKEN : randomBytes(32).toString('hex');

    await this.prisma.kioskDevice.update({
      where: { id: device.id },
      data: {
        tokenHash: hashToken(deviceToken),
        // Pilot keeps a reusable short code; production codes are one-shot
        pairCodeHash: device.deviceCode === 'FD-PILOT01' ? device.pairCodeHash : null,
        pairExpiresAt: device.deviceCode === 'FD-PILOT01' ? device.pairExpiresAt : null,
        lastSeenAt: new Date(),
      },
    });

    await this.audit.logAccess({
      organizationId: device.organizationId,
      objectType: 'kiosk_device',
      objectId: device.id,
      action: 'pair_claim',
    });

    return {
      ok: true as const,
      deviceId: device.id,
      deviceCode: device.deviceCode,
      label: device.label,
      deviceToken,
      mode: 'code' as const,
    };
  }

  /** Staff: issue a fresh short pair code for an existing device. */
  async refreshPairCode(actor: AuthUser, deviceId: string) {
    const device = await this.prisma.kioskDevice.findUnique({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('Device not found');
    const allowedRoles: MembershipRole[] = [
      MembershipRole.ORG_ADMIN,
      MembershipRole.TECH_IMPLEMENTATION,
      MembershipRole.PLATFORM_ADMIN,
    ];
    const allowed = actor.memberships.some(
      (m) => m.organizationId === device.organizationId && allowedRoles.includes(m.role),
    );
    if (!allowed) throw new ForbiddenException('Admin role required');

    const pairCode = randomPairCode(8);
    const pairExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.prisma.kioskDevice.update({
      where: { id: device.id },
      data: {
        pairCodeHash: hashToken(normalizePairCode(pairCode)),
        pairExpiresAt,
      },
    });
    return {
      id: device.id,
      deviceCode: device.deviceCode,
      pairCode,
      pairExpiresAt,
    };
  }

  async deviceMe(kiosk: KioskContext) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: kiosk.organizationId },
      select: {
        id: true,
        nameRu: true,
        nameKk: true,
        catalogCity: true,
        catalogAddress: true,
        emergencyKioskEnabled: true,
      },
    });
    return {
      device: {
        id: kiosk.id,
        label: kiosk.label,
        deviceCode: kiosk.deviceCode,
        appVersion: kiosk.appVersion,
        otaChannel: kiosk.otaChannel,
      },
      organization: org,
      emergencyAvailable: kiosk.emergencyEnabled && org.emergencyKioskEnabled,
    };
  }

  async reportVersion(kiosk: KioskContext, appVersion: string) {
    await this.prisma.kioskDevice.update({
      where: { id: kiosk.id },
      data: { appVersion, lastSeenAt: new Date() },
    });
    return this.checkOta(kiosk, appVersion);
  }

  async checkOta(kiosk: KioskContext, currentVersion: string) {
    const latest = await this.prisma.frontDeskRelease.findFirst({
      where: { channel: kiosk.otaChannel },
      orderBy: { publishedAt: 'desc' },
    });
    if (!latest) {
      return { updateAvailable: false as const, currentVersion };
    }
    const newer = cmpSemver(latest.version, currentVersion) > 0;
    return {
      updateAvailable: newer,
      currentVersion,
      latest: newer
        ? {
            version: latest.version,
            downloadUrl: latest.downloadUrl,
            checksumSha256: latest.checksumSha256,
            notesRu: latest.notesRu,
            mandatory: latest.mandatory,
          }
        : undefined,
    };
  }

  async publishRelease(
    actor: AuthUser,
    input: {
      channel: string;
      version: string;
      downloadUrl?: string;
      checksumSha256?: string;
      notesRu?: string;
      mandatory?: boolean;
    },
  ) {
    const techRoles: MembershipRole[] = [
      MembershipRole.TECH_IMPLEMENTATION,
      MembershipRole.TECH_SUPPORT,
      MembershipRole.PLATFORM_ADMIN,
    ];
    const isTech = actor.memberships.some((m) => techRoles.includes(m.role));
    if (!isTech) throw new ForbiddenException('Tech role required');

    return this.prisma.frontDeskRelease.upsert({
      where: {
        channel_version: { channel: input.channel, version: input.version },
      },
      create: {
        channel: input.channel,
        version: input.version,
        downloadUrl: input.downloadUrl,
        checksumSha256: input.checksumSha256,
        notesRu: input.notesRu,
        mandatory: input.mandatory ?? false,
      },
      update: {
        downloadUrl: input.downloadUrl,
        checksumSha256: input.checksumSha256,
        notesRu: input.notesRu,
        mandatory: input.mandatory ?? false,
        publishedAt: new Date(),
      },
    });
  }

  requestCode(iin: string, ip?: string) {
    return this.patient.requestCode(iin, ip);
  }

  verifyCode(input: {
    iin: string;
    code: string;
    ip?: string;
    userAgent?: string;
  }) {
    return this.patient.verifyCode(input);
  }

  async listOffers(kiosk: KioskContext) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: kiosk.organizationId },
      select: {
        id: true,
        nameRu: true,
        nameKk: true,
        catalogCity: true,
        catalogAddress: true,
      },
    });
    const offers = await this.prisma.catalogOffer.findMany({
      where: { organizationId: kiosk.organizationId, active: true },
      orderBy: { titleRu: 'asc' },
      select: {
        id: true,
        profileCode: true,
        titleRu: true,
        titleKk: true,
        descriptionRu: true,
        descriptionKk: true,
        durationMin: true,
      },
    });
    return { organization: org, offers };
  }

  async listSlots(kiosk: KioskContext, from: string, to: string, _profileCode?: string) {
    const fromDt = new Date(from);
    const toDt = new Date(to);
    if (Number.isNaN(fromDt.getTime()) || Number.isNaN(toDt.getTime())) {
      throw new BadRequestException('Invalid from/to');
    }
    return this.prisma.slot.findMany({
      where: {
        organizationId: kiosk.organizationId,
        startsAt: { gte: fromDt, lte: toDt },
        status: SlotStatus.FREE,
        appointment: { is: null },
      },
      orderBy: { startsAt: 'asc' },
      take: 200,
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        consultantUserId: true,
      },
    });
  }

  /**
   * Kiosk booking: ensure patient exists in this MO → case → consents UI → book slot.
   */
  async startBooking(
    kiosk: KioskContext,
    actor: AuthUser,
    input: { patientFullName: string; profileCode: string; mode?: CaseMode },
  ) {
    this.assertPatient(actor);
    if (!actor.iinHash) throw new ForbiddenException('Patient IIN required');

    const patient = await this.prisma.patient.findFirst({
      where: { organizationId: kiosk.organizationId, iinHash: actor.iinHash },
    });
    if (!patient) {
      throw new BadRequestException(
        'Patient not registered in this MO — ask registrar or use pilot IIN',
      );
    }

    // Re-fetch IIN is not available; createCase needs IIN string — use CasesService via upsert path
    // Work around: create case directly for existing patient
    const created = await this.prisma.$transaction(async (tx) => {
      const caseRow = await tx.case.create({
        data: {
          organizationId: kiosk.organizationId,
          patientId: patient.id,
          mode: input.mode ?? CaseMode.REALTIME,
          status: CaseStatus.CREATED,
          profileCode: input.profileCode,
          participants: {
            create: {
              userId: actor.id,
              role: MembershipRole.PATIENT,
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
          reason: 'kiosk_case_created',
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

    await this.prisma.patient.update({
      where: { id: patient.id },
      data: { fullName: input.patientFullName },
    });

    const pending = await this.patient.getMyCase(actor, created.id);

    await this.audit.logAccess({
      userId: actor.id,
      organizationId: kiosk.organizationId,
      objectType: 'case',
      objectId: created.id,
      action: 'kiosk_start_booking',
      role: MembershipRole.PATIENT,
    });

    return pending;
  }

  async acceptConsent(
    kiosk: KioskContext,
    actor: AuthUser,
    caseId: string,
    consentDocumentId: string,
    ip?: string,
  ) {
    const caseRow = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!caseRow || caseRow.organizationId !== kiosk.organizationId) {
      throw new ForbiddenException('Case not on this kiosk MO');
    }
    return this.patient.acceptConsent(actor, caseId, consentDocumentId, `kiosk:${kiosk.id}`, ip);
  }

  async bookSlot(kiosk: KioskContext, actor: AuthUser, caseId: string, slotId: string) {
    const caseRow = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!caseRow || caseRow.organizationId !== kiosk.organizationId) {
      throw new ForbiddenException('Case not on this kiosk MO');
    }
    const slot = await this.prisma.slot.findUnique({ where: { id: slotId } });
    if (!slot || slot.organizationId !== kiosk.organizationId) {
      throw new BadRequestException('Slot not available on this MO');
    }
    if (slot.status !== SlotStatus.FREE) {
      throw new BadRequestException('Slot not open');
    }
    const booked = await this.scheduling.bookSlot(actor, { caseId, slotId });
    const org = await this.prisma.organization.findUnique({
      where: { id: kiosk.organizationId },
      select: { nameRu: true, catalogAddress: true, catalogCity: true },
    });
    return {
      ...booked,
      ticket: {
        organizationName: org?.nameRu,
        address: [org?.catalogCity, org?.catalogAddress].filter(Boolean).join(', '),
        caseId,
        appointmentId: booked.id,
        startsAt: booked.slot.startsAt,
        endsAt: booked.slot.endsAt,
        patientName: actor.displayName,
      },
    };
  }

  async listMyAppointments(kiosk: KioskContext, actor: AuthUser) {
    this.assertPatient(actor);
    const patients = await this.prisma.patient.findMany({
      where: { organizationId: kiosk.organizationId, iinHash: actor.iinHash! },
      select: { id: true },
    });
    const patientIds = patients.map((p) => p.id);
    if (!patientIds.length) return [];

    return this.prisma.appointment.findMany({
      where: {
        organizationId: kiosk.organizationId,
        status: AppointmentStatus.ACTIVE,
        case: { patientId: { in: patientIds } },
      },
      orderBy: { slot: { startsAt: 'asc' } },
      include: {
        slot: { select: { startsAt: true, endsAt: true } },
        case: { select: { id: true, status: true, profileCode: true } },
      },
      take: 20,
    });
  }

  async cancelMyAppointment(
    kiosk: KioskContext,
    actor: AuthUser,
    appointmentId: string,
    reason: string,
  ) {
    this.assertPatient(actor);
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { case: { include: { patient: true } } },
    });
    if (!appt || appt.organizationId !== kiosk.organizationId) {
      throw new NotFoundException('Appointment not found');
    }
    if (appt.case.patient.iinHash !== actor.iinHash) {
      throw new ForbiddenException('Not your appointment');
    }
    return this.scheduling.cancelAppointment(
      actor,
      appointmentId,
      reason.trim() || 'Отмена на киоске',
    );
  }

  async raiseEmergency(kiosk: KioskContext, note?: string) {
    if (!kiosk.emergencyEnabled || !kiosk.orgEmergencyEnabled) {
      throw new ForbiddenException(
        'Emergency contour disabled — enable on device and MO (reglament required)',
      );
    }
    const event = await this.prisma.kioskEmergencyEvent.create({
      data: {
        organizationId: kiosk.organizationId,
        deviceId: kiosk.id,
        note: note?.slice(0, 200),
        status: 'OPEN',
      },
    });
    await this.audit.logAccess({
      organizationId: kiosk.organizationId,
      objectType: 'kiosk_emergency',
      objectId: event.id,
      action: 'raised',
    });
    return {
      id: event.id,
      status: event.status,
      messageRu: 'Вызов зарегистрирован. Ожидайте персонал регистратуры.',
      createdAt: event.createdAt,
    };
  }

  async listOpenEmergencies(actor: AuthUser, organizationId: string) {
    const roles: MembershipRole[] = [
      MembershipRole.REGISTRAR,
      MembershipRole.ORG_ADMIN,
      MembershipRole.AMBULATORY_WORKER,
      MembershipRole.DEPARTMENT_HEAD,
      MembershipRole.TECH_SUPPORT,
      MembershipRole.PLATFORM_ADMIN,
    ];
    const allowed = actor.memberships.some(
      (m) => m.organizationId === organizationId && roles.includes(m.role),
    );
    if (!allowed) throw new ForbiddenException();
    return this.prisma.kioskEmergencyEvent.findMany({
      where: { organizationId, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      include: { device: { select: { label: true, deviceCode: true } } },
      take: 50,
    });
  }

  async ackEmergency(actor: AuthUser, eventId: string) {
    const event = await this.prisma.kioskEmergencyEvent.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException();
    const roles: MembershipRole[] = [
      MembershipRole.REGISTRAR,
      MembershipRole.ORG_ADMIN,
      MembershipRole.AMBULATORY_WORKER,
      MembershipRole.TECH_SUPPORT,
      MembershipRole.PLATFORM_ADMIN,
    ];
    const allowed = actor.memberships.some(
      (m) => m.organizationId === event.organizationId && roles.includes(m.role),
    );
    if (!allowed) throw new ForbiddenException();
    return this.prisma.kioskEmergencyEvent.update({
      where: { id: eventId },
      data: { status: 'ACK', acknowledgedAt: new Date() },
    });
  }

  /** Dev/bootstrap helper — stable token + reusable short pair code. */
  async ensurePilotDevice(organizationId: string) {
    const PATIENT_IIN = '900000000009';
    await this.prisma.patient.upsert({
      where: {
        organizationId_iinHash: {
          organizationId,
          iinHash: hashIin(PATIENT_IIN),
        },
      },
      create: {
        organizationId,
        iinHash: hashIin(PATIENT_IIN),
        fullName: 'Пилотный пациент',
        phone: '+77001112233',
      },
      update: { fullName: 'Пилотный пациент' },
    });

    const existing = await this.prisma.kioskDevice.findFirst({
      where: { organizationId, deviceCode: 'FD-PILOT01' },
    });
    const token = PILOT_KIOSK_TOKEN;
    const pairExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const pairData = {
      tokenHash: hashToken(token),
      pairCodeHash: hashToken(normalizePairCode(PILOT_PAIR_CODE)),
      pairExpiresAt,
      enabled: true,
      emergencyEnabled: true,
      lastSeenAt: new Date(),
    };

    if (existing) {
      await this.prisma.kioskDevice.update({
        where: { id: existing.id },
        data: pairData,
      });
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { emergencyKioskEnabled: true },
      });
      return {
        deviceId: existing.id,
        deviceCode: existing.deviceCode,
        deviceToken: token,
        pairCode: PILOT_PAIR_CODE,
      };
    }
    const device = await this.prisma.kioskDevice.create({
      data: {
        organizationId,
        label: 'Пилотный киоск Айжан',
        deviceCode: 'FD-PILOT01',
        ...pairData,
        otaChannel: 'pilot',
        appVersion: '0.1.0',
      },
    });
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { emergencyKioskEnabled: true },
    });
    await this.prisma.frontDeskRelease.upsert({
      where: { channel_version: { channel: 'pilot', version: '0.1.0' } },
      create: {
        channel: 'pilot',
        version: '0.1.0',
        notesRu: 'FrontDesk F1 pilot shell',
        mandatory: false,
      },
      update: {},
    });
    return {
      deviceId: device.id,
      deviceCode: device.deviceCode,
      deviceToken: token,
      pairCode: PILOT_PAIR_CODE,
    };
  }

  private assertPatient(actor: AuthUser) {
    if (!actor.memberships.some((m) => m.role === MembershipRole.PATIENT)) {
      throw new ForbiddenException('Patient session required');
    }
  }
}
