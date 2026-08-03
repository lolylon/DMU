import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  CaseStatus,
  MembershipRole,
  Prisma,
  SlotStatus,
} from '@prisma/client';
import { TIMEZONE } from '@miru/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';

function parseHm(hm: string): { h: number; m: number } {
  const m = /^(\d{2}):(\d{2})$/.exec(hm);
  if (!m) throw new BadRequestException(`Invalid time ${hm}, expected HH:MM`);
  return { h: Number(m[1]), m: Number(m[2]) };
}

function atLocalDate(day: Date, hm: string, timeZone: string): Date {
  // Store UTC instants; interpret wall clock in org TZ via formatting trick
  const { h, m } = parseHm(hm);
  const y = day.getUTCFullYear();
  const mo = day.getUTCMonth();
  const d = day.getUTCDate();
  // Build as if Asia/Almaty (UTC+5, no DST) — matches TIMEZONE default for RK
  if (timeZone !== TIMEZONE) {
    // Keep simple for W1: only Asia/Almaty supported until TZ library is added
  }
  const utcMs = Date.UTC(y, mo, d, h - 5, m, 0, 0);
  return new Date(utcMs);
}

@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async upsertSchedule(
    actor: AuthUser,
    input: {
      organizationId: string;
      consultantUserId: string;
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      slotDurationMinutes: number;
      breakStart?: string;
      breakEnd?: string;
    },
  ) {
    this.assertCanManageSchedule(actor, input.organizationId, input.consultantUserId);
    if (input.dayOfWeek < 1 || input.dayOfWeek > 7) {
      throw new BadRequestException('dayOfWeek must be 1..7 (ISO)');
    }
    if (input.slotDurationMinutes < 10 || input.slotDurationMinutes > 180) {
      throw new BadRequestException('slotDurationMinutes out of range');
    }
    parseHm(input.startTime);
    parseHm(input.endTime);

    return this.prisma.consultantSchedule.upsert({
      where: {
        consultantUserId_dayOfWeek_startTime_endTime: {
          consultantUserId: input.consultantUserId,
          dayOfWeek: input.dayOfWeek,
          startTime: input.startTime,
          endTime: input.endTime,
        },
      },
      create: {
        organizationId: input.organizationId,
        consultantUserId: input.consultantUserId,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
        slotDurationMinutes: input.slotDurationMinutes,
        breakStart: input.breakStart,
        breakEnd: input.breakEnd,
        timezone: TIMEZONE,
        active: true,
      },
      update: {
        slotDurationMinutes: input.slotDurationMinutes,
        breakStart: input.breakStart ?? null,
        breakEnd: input.breakEnd ?? null,
        active: true,
      },
    });
  }

  listSchedules(actor: AuthUser, organizationId: string, consultantUserId?: string) {
    this.assertOrg(actor, organizationId);
    return this.prisma.consultantSchedule.findMany({
      where: {
        organizationId,
        active: true,
        ...(consultantUserId ? { consultantUserId } : {}),
      },
      orderBy: [{ consultantUserId: 'asc' }, { dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  /** TZ 6.2.2 — generate FREE slots from weekly templates for a date range */
  async generateSlots(
    actor: AuthUser,
    input: { organizationId: string; consultantUserId: string; fromDate: string; toDate: string },
  ) {
    this.assertCanManageSchedule(actor, input.organizationId, input.consultantUserId);
    const from = new Date(`${input.fromDate}T00:00:00.000Z`);
    const to = new Date(`${input.toDate}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
      throw new BadRequestException('Invalid fromDate/toDate (YYYY-MM-DD)');
    }

    const templates = await this.prisma.consultantSchedule.findMany({
      where: {
        organizationId: input.organizationId,
        consultantUserId: input.consultantUserId,
        active: true,
      },
    });
    if (!templates.length) {
      throw new BadRequestException('No active schedule templates for consultant');
    }

    const created: string[] = [];
    for (let t = from.getTime(); t <= to.getTime(); t += 86400000) {
      const day = new Date(t);
      const isoDow = ((day.getUTCDay() + 6) % 7) + 1; // Mon=1
      const dayTemplates = templates.filter((x) => x.dayOfWeek === isoDow);
      for (const tpl of dayTemplates) {
        const slots = this.expandTemplate(day, tpl);
        for (const s of slots) {
          try {
            const row = await this.prisma.slot.create({
              data: {
                organizationId: input.organizationId,
                consultantUserId: input.consultantUserId,
                startsAt: s.startsAt,
                endsAt: s.endsAt,
                status: SlotStatus.FREE,
              },
            });
            created.push(row.id);
          } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
              // already generated — skip
              continue;
            }
            throw e;
          }
        }
      }
    }

    return { createdCount: created.length, createdIds: created };
  }

  async listFreeSlots(
    actor: AuthUser,
    organizationId: string,
    consultantUserId: string,
    fromIso: string,
    toIso: string,
  ) {
    this.assertOrg(actor, organizationId);
    return this.prisma.slot.findMany({
      where: {
        organizationId,
        consultantUserId,
        status: SlotStatus.FREE,
        startsAt: { gte: new Date(fromIso), lte: new Date(toIso) },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  /** TZ 6.2.7 — registrar blocks slots (vacation/sick) */
  async blockSlot(actor: AuthUser, slotId: string, reason: string) {
    if (!reason.trim()) throw new BadRequestException('Block reason is mandatory');
    const slot = await this.prisma.slot.findUnique({ where: { id: slotId } });
    if (!slot) throw new NotFoundException('Slot not found');
    this.assertCanManageSchedule(actor, slot.organizationId, slot.consultantUserId);
    if (slot.status === SlotStatus.BOOKED) {
      throw new ConflictException('Cannot block a booked slot');
    }
    return this.prisma.slot.update({
      where: { id: slotId },
      data: { status: SlotStatus.BLOCKED, blockedReason: reason },
    });
  }

  /**
   * TZ 6.2.3–6.2.6 — book free slot onto case; atomic claim prevents double booking.
   */
  async bookSlot(actor: AuthUser, input: { caseId: string; slotId: string }) {
    const caseRow = await this.prisma.case.findUnique({
      where: { id: input.caseId },
      include: { participants: true, patient: true, acceptances: true },
    });
    if (!caseRow) throw new NotFoundException('Case not found');

    const isPatientOwner =
      !!actor.iinHash &&
      caseRow.patient.iinHash === actor.iinHash &&
      actor.memberships.some((m) => m.role === MembershipRole.PATIENT);

    if (!isPatientOwner) {
      this.casesAssertAccess(actor, caseRow);
    } else if (caseRow.organizationId && !actor.memberships.some((m) => m.organizationId === caseRow.organizationId)) {
      throw new ForbiddenException('No membership in organization');
    }

    if (caseRow.status !== CaseStatus.AWAITING_BOOKING && caseRow.status !== CaseStatus.RESCHEDULED) {
      throw new BadRequestException(`Case status ${caseRow.status} does not allow booking`);
    }
    if (caseRow.acceptances.length === 0) {
      throw new BadRequestException('Consent required before booking (TZ 7.1.6)');
    }

    const active = await this.prisma.appointment.findFirst({
      where: { caseId: input.caseId, status: AppointmentStatus.ACTIVE },
    });
    if (active) {
      throw new ConflictException('Case already has an active appointment');
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.slot.updateMany({
          where: { id: input.slotId, status: SlotStatus.FREE },
          data: { status: SlotStatus.BOOKED },
        });
        if (claimed.count !== 1) {
          throw new ConflictException('Slot is not free (TZ 6.2.6 race protection)');
        }

        const slot = await tx.slot.findUniqueOrThrow({ where: { id: input.slotId } });
        if (slot.organizationId !== caseRow.organizationId) {
          throw new ForbiddenException('Slot belongs to another organization');
        }

        const appointment = await tx.appointment.create({
          data: {
            organizationId: caseRow.organizationId,
            caseId: caseRow.id,
            slotId: slot.id,
            bookedByUserId: actor.id,
            status: AppointmentStatus.ACTIVE,
          },
          include: { slot: true },
        });

        // Ensure consultant is a participant
        await tx.caseParticipant.upsert({
          where: {
            caseId_userId_role: {
              caseId: caseRow.id,
              userId: slot.consultantUserId,
              role: MembershipRole.CONSULTANT,
            },
          },
          create: {
            caseId: caseRow.id,
            userId: slot.consultantUserId,
            role: MembershipRole.CONSULTANT,
          },
          update: {},
        });

        const fromStatus = caseRow.status;
        await tx.case.update({
          where: { id: caseRow.id },
          data: { status: CaseStatus.BOOKED },
        });
        await tx.caseStatusHistory.create({
          data: {
            caseId: caseRow.id,
            fromStatus,
            toStatus: CaseStatus.BOOKED,
            actorId: actor.id,
            reason: 'slot_booked',
          },
        });

        return appointment;
      });

      await this.notifications.notifyBookingChange({
        organizationId: caseRow.organizationId,
        caseId: caseRow.id,
        templateKey: 'booking_confirmed',
        patientRef: caseRow.patientId,
        consultantRef: result.slot.consultantUserId,
        meta: { slotId: result.slotId, startsAt: result.slot.startsAt },
      });

      await this.audit.logAccess({
        userId: actor.id,
        organizationId: caseRow.organizationId,
        objectType: 'appointment',
        objectId: result.id,
        action: 'book',
      });

      if (caseRow.profileCode) {
        await this.prisma.profileQueueItem.upsert({
          where: { caseId: caseRow.id },
          create: {
            organizationId: caseRow.organizationId,
            profileCode: caseRow.profileCode,
            caseId: caseRow.id,
            status: 'ASSIGNED',
            assignedConsultantId: result.slot.consultantUserId,
            assignedAt: new Date(),
          },
          update: {
            status: 'ASSIGNED',
            assignedConsultantId: result.slot.consultantUserId,
            assignedAt: new Date(),
          },
        });
      }

      return result;
    } catch (e) {
      if (e instanceof ConflictException || e instanceof ForbiddenException) throw e;
      throw e;
    }
  }

  /** FIFO: next PENDING case for profile, assign to consultant */
  async claimNextProfileQueue(
    actor: AuthUser,
    organizationId: string,
    profileCode: string,
  ) {
    this.assertOrg(actor, organizationId);
    const isConsultant = actor.memberships.some(
      (m) => m.organizationId === organizationId && m.role === MembershipRole.CONSULTANT,
    );
    if (!isConsultant) throw new ForbiddenException('Consultant role required');

    const next = await this.prisma.profileQueueItem.findFirst({
      where: { organizationId, profileCode, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: {
        case: { include: { patient: { select: { id: true, fullName: true } } } },
      },
    });
    if (!next) return { empty: true as const };

    const updated = await this.prisma.profileQueueItem.update({
      where: { id: next.id },
      data: {
        status: 'ASSIGNED',
        assignedConsultantId: actor.id,
        assignedAt: new Date(),
      },
      include: {
        case: { include: { patient: { select: { id: true, fullName: true } } } },
      },
    });

    await this.prisma.caseParticipant.upsert({
      where: {
        caseId_userId_role: {
          caseId: next.caseId,
          userId: actor.id,
          role: MembershipRole.CONSULTANT,
        },
      },
      create: {
        caseId: next.caseId,
        userId: actor.id,
        role: MembershipRole.CONSULTANT,
      },
      update: {},
    });

    return { empty: false as const, item: updated };
  }

  async enqueueProfile(caseId: string) {
    const caseRow = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!caseRow?.profileCode) return null;
    return this.prisma.profileQueueItem.upsert({
      where: { caseId },
      create: {
        organizationId: caseRow.organizationId,
        profileCode: caseRow.profileCode,
        caseId,
        status: 'PENDING',
      },
      update: {},
    });
  }

  async listProfileQueue(actor: AuthUser, organizationId: string, profileCode?: string) {
    this.assertOrg(actor, organizationId);
    return this.prisma.profileQueueItem.findMany({
      where: {
        organizationId,
        ...(profileCode ? { profileCode } : {}),
        status: { in: ['PENDING', 'ASSIGNED'] },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: {
        case: {
          select: {
            id: true,
            status: true,
            mode: true,
            profileCode: true,
            patient: { select: { fullName: true } },
          },
        },
      },
    });
  }

  /** TZ 6.2.5 — cancel with mandatory reason, notify both sides */
  async cancelAppointment(actor: AuthUser, appointmentId: string, reason: string) {
    if (!reason.trim()) {
      throw new BadRequestException('Cancellation reason is mandatory (TZ 6.2.5)');
    }

    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        slot: true,
        case: { include: { participants: true, patient: true } },
      },
    });
    if (!appt || appt.status !== AppointmentStatus.ACTIVE) {
      throw new NotFoundException('Active appointment not found');
    }

    const isPatientOwner =
      !!actor.iinHash &&
      appt.case.patient.iinHash === actor.iinHash &&
      actor.memberships.some((m) => m.role === MembershipRole.PATIENT);
    if (!isPatientOwner) {
      this.casesAssertAccess(actor, appt.case);
    } else if (
      !actor.memberships.some((m) => m.organizationId === appt.organizationId)
    ) {
      throw new ForbiddenException('No membership in organization');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: AppointmentStatus.CANCELLED, cancelReason: reason },
      });
      await tx.slot.update({
        where: { id: appt.slotId },
        data: { status: SlotStatus.FREE },
      });
      await tx.case.update({
        where: { id: appt.caseId },
        data: { status: CaseStatus.CANCELLED, closeReason: reason },
      });
      await tx.caseStatusHistory.create({
        data: {
          caseId: appt.caseId,
          fromStatus: appt.case.status,
          toStatus: CaseStatus.CANCELLED,
          reason,
          actorId: actor.id,
        },
      });
    });

    await this.notifications.notifyBookingChange({
      organizationId: appt.organizationId,
      caseId: appt.caseId,
      templateKey: 'booking_cancelled',
      patientRef: appt.case.patientId,
      consultantRef: appt.slot.consultantUserId,
      meta: { reason },
    });

    return { ok: true };
  }

  /** TZ 6.2.5 — reschedule: free old slot, mark RESCHEDULED, book new slot */
  async rescheduleAppointment(
    actor: AuthUser,
    appointmentId: string,
    newSlotId: string,
    reason: string,
  ) {
    if (!reason.trim()) {
      throw new BadRequestException('Reschedule reason is mandatory (TZ 6.2.5)');
    }

    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { slot: true, case: { include: { participants: true, acceptances: true, patient: true } } },
    });
    if (!appt || appt.status !== AppointmentStatus.ACTIVE) {
      throw new NotFoundException('Active appointment not found');
    }
    this.casesAssertAccess(actor, appt.case);

    const booked = await this.prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: AppointmentStatus.RESCHEDULED, cancelReason: reason },
      });
      await tx.slot.update({
        where: { id: appt.slotId },
        data: { status: SlotStatus.FREE },
      });
      await tx.case.update({
        where: { id: appt.caseId },
        data: { status: CaseStatus.RESCHEDULED },
      });
      await tx.caseStatusHistory.create({
        data: {
          caseId: appt.caseId,
          fromStatus: appt.case.status,
          toStatus: CaseStatus.RESCHEDULED,
          reason,
          actorId: actor.id,
        },
      });

      const claimed = await tx.slot.updateMany({
        where: { id: newSlotId, status: SlotStatus.FREE },
        data: { status: SlotStatus.BOOKED },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('New slot is not free');
      }
      const newSlot = await tx.slot.findUniqueOrThrow({ where: { id: newSlotId } });
      if (newSlot.organizationId !== appt.organizationId) {
        throw new ForbiddenException('Slot belongs to another organization');
      }

      const newAppt = await tx.appointment.create({
        data: {
          organizationId: appt.organizationId,
          caseId: appt.caseId,
          slotId: newSlot.id,
          bookedByUserId: actor.id,
          status: AppointmentStatus.ACTIVE,
        },
        include: { slot: true },
      });

      await tx.case.update({
        where: { id: appt.caseId },
        data: { status: CaseStatus.BOOKED },
      });
      await tx.caseStatusHistory.create({
        data: {
          caseId: appt.caseId,
          fromStatus: CaseStatus.RESCHEDULED,
          toStatus: CaseStatus.BOOKED,
          reason: 'rescheduled_to_new_slot',
          actorId: actor.id,
        },
      });

      return newAppt;
    });

    await this.notifications.notifyBookingChange({
      organizationId: appt.organizationId,
      caseId: appt.caseId,
      templateKey: 'booking_rescheduled',
      patientRef: appt.case.patientId,
      consultantRef: booked.slot.consultantUserId,
      meta: { reason, newSlotId },
    });

    return booked;
  }

  private expandTemplate(
    day: Date,
    tpl: {
      startTime: string;
      endTime: string;
      slotDurationMinutes: number;
      breakStart: string | null;
      breakEnd: string | null;
      timezone: string;
    },
  ): { startsAt: Date; endsAt: Date }[] {
    const start = atLocalDate(day, tpl.startTime, tpl.timezone);
    const end = atLocalDate(day, tpl.endTime, tpl.timezone);
    const breakStart = tpl.breakStart ? atLocalDate(day, tpl.breakStart, tpl.timezone) : null;
    const breakEnd = tpl.breakEnd ? atLocalDate(day, tpl.breakEnd, tpl.timezone) : null;
    const durationMs = tpl.slotDurationMinutes * 60_000;
    const out: { startsAt: Date; endsAt: Date }[] = [];

    for (let t = start.getTime(); t + durationMs <= end.getTime(); t += durationMs) {
      const startsAt = new Date(t);
      const endsAt = new Date(t + durationMs);
      if (breakStart && breakEnd) {
        const overlapsBreak = startsAt < breakEnd && endsAt > breakStart;
        if (overlapsBreak) continue;
      }
      out.push({ startsAt, endsAt });
    }
    return out;
  }

  /**
   * Bootstrap / pilot helper — Mon–Fri templates + FREE slots for ~14 days.
   * No auth actor (dev/ALLOW_BOOTSTRAP only callers).
   */
  async seedPilotAvailability(organizationId: string, consultantUserId: string) {
    for (const dayOfWeek of [1, 2, 3, 4, 5]) {
      await this.prisma.consultantSchedule.upsert({
        where: {
          consultantUserId_dayOfWeek_startTime_endTime: {
            consultantUserId,
            dayOfWeek,
            startTime: '09:00',
            endTime: '17:00',
          },
        },
        create: {
          organizationId,
          consultantUserId,
          dayOfWeek,
          startTime: '09:00',
          endTime: '17:00',
          slotDurationMinutes: 30,
          breakStart: '13:00',
          breakEnd: '14:00',
          timezone: TIMEZONE,
          active: true,
        },
        update: { active: true, slotDurationMinutes: 30 },
      });
    }

    const from = new Date();
    from.setUTCHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 14 * 86400000);
    const schedules = await this.prisma.consultantSchedule.findMany({
      where: { organizationId, consultantUserId, active: true },
    });

    let created = 0;
    for (let t = from.getTime(); t <= to.getTime(); t += 86400000) {
      const day = new Date(t);
      const isoDow = ((day.getUTCDay() + 6) % 7) + 1;
      for (const sch of schedules.filter((s) => s.dayOfWeek === isoDow)) {
        for (const w of this.expandTemplate(day, sch)) {
          try {
            await this.prisma.slot.create({
              data: {
                organizationId,
                consultantUserId,
                startsAt: w.startsAt,
                endsAt: w.endsAt,
                status: SlotStatus.FREE,
              },
            });
            created += 1;
          } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
              continue;
            }
            throw e;
          }
        }
      }
    }
    return { created, from: from.toISOString(), to: to.toISOString() };
  }

  private assertOrg(actor: AuthUser, organizationId: string) {
    if (!actor.memberships.some((m) => m.organizationId === organizationId)) {
      throw new ForbiddenException('No membership in organization');
    }
  }

  private assertCanManageSchedule(actor: AuthUser, organizationId: string, consultantUserId: string) {
    this.assertOrg(actor, organizationId);
    const roleOk = actor.memberships.some(
      (m) =>
        m.organizationId === organizationId &&
        (
          [
            MembershipRole.CONSULTANT,
            MembershipRole.REGISTRAR,
            MembershipRole.DEPARTMENT_HEAD,
            MembershipRole.ORG_ADMIN,
          ] as MembershipRole[]
        ).includes(m.role),
    );
    if (!roleOk) throw new ForbiddenException('Cannot manage schedule');
    const isSelfConsultant = actor.memberships.some(
      (m) =>
        m.organizationId === organizationId &&
        m.role === MembershipRole.CONSULTANT &&
        actor.id === consultantUserId,
    );
    const isAdminish = actor.memberships.some(
      (m) =>
        m.organizationId === organizationId &&
        (
          [MembershipRole.REGISTRAR, MembershipRole.DEPARTMENT_HEAD, MembershipRole.ORG_ADMIN] as MembershipRole[]
        ).includes(m.role),
    );
    if (!isSelfConsultant && !isAdminish) {
      throw new ForbiddenException('Consultants may only manage own schedule');
    }
  }

  private casesAssertAccess(
    actor: AuthUser,
    caseRow: { organizationId: string; participants: { userId: string }[] },
  ) {
    // Reuse CasesService private logic via thin public wrapper would be better;
    // duplicate minimal check to avoid refactor mid-W1.
    this.assertOrg(actor, caseRow.organizationId);
    const privileged = actor.memberships.some(
      (m) =>
        m.organizationId === caseRow.organizationId &&
        (
          [
            MembershipRole.AUDITOR,
            MembershipRole.ORG_ADMIN,
            MembershipRole.REGISTRAR,
            MembershipRole.DEPARTMENT_HEAD,
            MembershipRole.CONSULTANT,
            MembershipRole.AMBULATORY_WORKER,
          ] as MembershipRole[]
        ).includes(m.role),
    );
    const participant = caseRow.participants.some((p) => p.userId === actor.id);
    if (!privileged && !participant) {
      throw new ForbiddenException('No object-level access to this case');
    }
  }
}
