import { BadRequestException, Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { IsOptional, IsString, IsUrl } from 'class-validator';
import * as QRCode from 'qrcode';
import { Public } from '../common/decorators';
import { assertBootstrapEnabled } from '../common/bootstrap-gate';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from '../identity/identity.service';
import { ConsentService } from '../consent/consent.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FrontdeskService } from '../frontdesk/frontdesk.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { hashIin } from '../common/crypto';
import { ORG_READINESS_TEMPLATE } from '../admin/readiness.template';

/** Valid test IIN for pilot consultant (ЭЦП bind, TZ 9.3.3) */
const CONSULTANT_IIN = '880101300000';

/** Stable pilot TOTP — never rotate on re-bootstrap (Authenticator stays valid). Base32 only. */
const PILOT_TOTP = {
  consultant: 'MIRUCONSULTANT22',
  ambulatory: 'MIRUAMBULATORY22',
  tech: 'MIRUTECHADMIN2222',
} as const;

function cleanTotpSecret(secret: string): string {
  return secret.replace(/\s+/g, '').toUpperCase();
}

function totpOtpauthUri(email: string, secret: string): string {
  const s = cleanTotpSecret(secret);
  return `otpauth://totp/Miru:${encodeURIComponent(email)}?secret=${s}&issuer=Miru&algorithm=SHA1&digits=6&period=30`;
}

async function totpQrDataUrl(email: string, secret: string): Promise<string> {
  return QRCode.toDataURL(totpOtpauthUri(email, secret), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 220,
  });
}

class TelegramMenuDto {
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  webAppUrl?: string;
}

/**
 * Dev/pilot bootstrap only. Disabled unless ALLOW_BOOTSTRAP=true.
 * Production: also requires header x-bootstrap-secret = BOOTSTRAP_SECRET.
 * Disable ALLOW_BOOTSTRAP immediately after seed (NFR 12.5).
 */
@Controller('bootstrap')
export class BootstrapController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly consent: ConsentService,
    private readonly notifications: NotificationsService,
    private readonly frontdesk: FrontdeskService,
    private readonly scheduling: SchedulingService,
  ) {}

  @Public()
  @Post('telegram-menu')
  async telegramMenu(
    @Body() body: TelegramMenuDto,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    assertBootstrapEnabled(headers);
    const url =
      body.webAppUrl ??
      process.env.TELEGRAM_WEBAPP_URL ??
      '';
    if (!url.startsWith('https://')) {
      throw new BadRequestException('webAppUrl / TELEGRAM_WEBAPP_URL must be https');
    }
    const result = await this.notifications.configureBotMenuButton(url);
    return { ok: true, webAppUrl: url, result };
  }

  @Public()
  @Get('pilot-totp')
  async pilotTotp(@Headers() headers: Record<string, string | string[] | undefined>) {
    assertBootstrapEnabled(headers);
    const consultantEmail = 'consultant@pilot.miru.local';
    const ambulatoryEmail = 'ambulatory@pilot.miru.local';
    const techEmail = 'tech@pilot.miru.local';
    const [consultantQr, ambulatoryQr, techQr] = await Promise.all([
      totpQrDataUrl(consultantEmail, PILOT_TOTP.consultant),
      totpQrDataUrl(ambulatoryEmail, PILOT_TOTP.ambulatory),
      totpQrDataUrl(techEmail, PILOT_TOTP.tech),
    ]);
    return {
      note: 'Постоянные ключи пилота — отсканируй QR в Authenticator один раз. Bootstrap их больше не меняет.',
      password: 'ChangeMeNow!99',
      consultant: {
        email: consultantEmail,
        totpSecret: PILOT_TOTP.consultant,
        otpauthUri: totpOtpauthUri(consultantEmail, PILOT_TOTP.consultant),
        qrDataUrl: consultantQr,
        url: 'http://localhost:5173',
      },
      ambulatory: {
        email: ambulatoryEmail,
        totpSecret: PILOT_TOTP.ambulatory,
        otpauthUri: totpOtpauthUri(ambulatoryEmail, PILOT_TOTP.ambulatory),
        qrDataUrl: ambulatoryQr,
        url: 'http://localhost:5173',
      },
      tech: {
        email: techEmail,
        totpSecret: PILOT_TOTP.tech,
        otpauthUri: totpOtpauthUri(techEmail, PILOT_TOTP.tech),
        qrDataUrl: techQr,
        url: 'http://localhost:5174',
      },
    };
  }

  @Public()
  @Get('pilot-kiosk')
  async pilotKiosk(@Headers() headers: Record<string, string | string[] | undefined>) {
    assertBootstrapEnabled(headers);
    const org = await this.prisma.organization.findUnique({
      where: { bin: '123456789012' },
    });
    if (!org) {
      throw new BadRequestException('Сначала POST /api/bootstrap/demo');
    }
    const kiosk = await this.frontdesk.ensurePilotDevice(org.id);
    return {
      note: 'На киоске нажмите «Подключить пилотный терминал» или введите pairCode. Токен стабильный.',
      url: 'http://localhost:5177',
      deviceCode: kiosk.deviceCode,
      pairCode: kiosk.pairCode,
      deviceToken: kiosk.deviceToken,
    };
  }

  @Public()
  @Post('demo')
  async demo(@Headers() headers: Record<string, string | string[] | undefined>) {
    assertBootstrapEnabled(headers);

    const existing = await this.prisma.organization.findUnique({
      where: { bin: '123456789012' },
    });
    if (existing) {
      const consultantTotp = PILOT_TOTP.consultant;
      const techTotp = PILOT_TOTP.tech;
      const awTotp = PILOT_TOTP.ambulatory;
      const password = 'ChangeMeNow!99';

      let consultant = await this.prisma.user.findUnique({
        where: { email: 'consultant@pilot.miru.local' },
      });
      if (!consultant) {
        consultant = await this.identity.createStaffUser({
          email: 'consultant@pilot.miru.local',
          password,
          displayName: 'Пилотный консультант',
          organizationId: existing.id,
          role: MembershipRole.CONSULTANT,
        });
      }
      await this.prisma.user.update({
        where: { id: consultant.id },
        data: {
          iinHash: hashIin(CONSULTANT_IIN),
          totpSecret: consultantTotp,
          totpEnabled: true,
          failedLoginCount: 0,
          lockedUntil: null,
          isBlocked: false,
        },
      });

      let tech = await this.prisma.user.findUnique({
        where: { email: 'tech@pilot.miru.local' },
      });
      if (!tech) {
        tech = await this.identity.createStaffUser({
          email: 'tech@pilot.miru.local',
          password,
          displayName: 'Пилотный внедряющий',
          organizationId: existing.id,
          role: MembershipRole.TECH_IMPLEMENTATION,
        });
      }
      await this.prisma.user.update({
        where: { id: tech.id },
        data: {
          totpSecret: techTotp,
          totpEnabled: true,
          failedLoginCount: 0,
          lockedUntil: null,
          isBlocked: false,
        },
      });

      // Scenario B: ambulatory worker
      let aw = await this.prisma.user.findUnique({
        where: { email: 'ambulatory@pilot.miru.local' },
      });
      if (!aw) {
        aw = await this.identity.createStaffUser({
          email: 'ambulatory@pilot.miru.local',
          password,
          displayName: 'Пилотный ВА',
          organizationId: existing.id,
          role: MembershipRole.AMBULATORY_WORKER,
        });
      }
      await this.prisma.user.update({
        where: { id: aw.id },
        data: {
          totpSecret: awTotp,
          totpEnabled: true,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });

      await this.prisma.organization.update({
        where: { id: existing.id },
        data: {
          misMode: 'manual',
          catalogPublic: true,
          catalogCity: 'Алматы',
          catalogAddress: 'Пилотный контур',
        },
      });
      await this.prisma.catalogOffer.upsert({
        where: {
          organizationId_profileCode: {
            organizationId: existing.id,
            profileCode: 'therapy',
          },
        },
        create: {
          organizationId: existing.id,
          profileCode: 'therapy',
          titleRu: 'Терапия (ДМУ)',
          titleKk: 'Терапия (ҚМУ)',
          descriptionRu: 'Дистанционная консультация терапевта',
          descriptionKk: 'Терапевттің қашықтан консультациясы',
          durationMin: 30,
          active: true,
        },
        update: { active: true },
      });

      for (const tpl of ORG_READINESS_TEMPLATE) {
        await this.prisma.orgReadinessItem.upsert({
          where: {
            organizationId_key: { organizationId: existing.id, key: tpl.key },
          },
          create: {
            organizationId: existing.id,
            key: tpl.key,
            labelRu: tpl.labelRu,
            required: tpl.required,
            kind: tpl.kind,
            done: tpl.key === 'org_created',
            doneAt: tpl.key === 'org_created' ? new Date() : null,
          },
          update: {},
        });
      }

      const kiosk = await this.frontdesk.ensurePilotDevice(existing.id);
      const slots = await this.scheduling.seedPilotAvailability(existing.id, consultant.id);

      return {
        ok: true,
        message: 'Already bootstrapped — TOTP secrets are STABLE (not rotated)',
        organizationId: existing.id,
        consultantIin: CONSULTANT_IIN,
        password,
        howToTotp:
          'Добавь totpSecret в Authenticator ОДИН раз (Time-based). Ключи постоянные — bootstrap их не меняет. См. GET /api/bootstrap/pilot-totp',
        consultant: {
          email: 'consultant@pilot.miru.local',
          password,
          totpSecret: consultantTotp,
          otpauthUri: totpOtpauthUri('consultant@pilot.miru.local', consultantTotp),
          url: 'http://localhost:5173',
        },
        ambulatory: {
          email: 'ambulatory@pilot.miru.local',
          password,
          totpSecret: awTotp,
          otpauthUri: totpOtpauthUri('ambulatory@pilot.miru.local', awTotp),
          url: 'http://localhost:5173',
        },
        tech: {
          email: 'tech@pilot.miru.local',
          password,
          totpSecret: techTotp,
          otpauthUri: totpOtpauthUri('tech@pilot.miru.local', techTotp),
          url: 'http://localhost:5174',
        },
        patient: {
          iin: '900000000009',
          url: 'http://localhost:5175',
          note: 'В production OTP только через SMS/Telegram; debugCode не отдаётся',
        },
        frontdesk: {
          url: 'http://localhost:5177',
          deviceCode: kiosk.deviceCode,
          pairCode: kiosk.pairCode,
          deviceToken: kiosk.deviceToken,
          note: 'На :5177 — кнопка «Подключить пилотный терминал» или код PILOT1. Длинный token не нужен.',
        },
        slotsSeeded: slots.created,
      };
    }

    const org = await this.prisma.organization.create({
      data: {
        bin: '123456789012',
        nameKk: 'Пилоттық Аурухана',
        nameRu: 'Пилотная больница',
        status: 'testing',
        misMode: 'manual',
        catalogPublic: true,
        catalogCity: 'Алматы',
        catalogAddress: 'Пилотный контур',
      },
    });

    const password = 'ChangeMeNow!99';
    const totpSecret = PILOT_TOTP.consultant;
    const user = await this.identity.createStaffUser({
      email: 'consultant@pilot.miru.local',
      password,
      displayName: 'Пилотный консультант',
      organizationId: org.id,
      role: MembershipRole.CONSULTANT,
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecret,
        totpEnabled: true,
        iinHash: hashIin(CONSULTANT_IIN),
      },
    });

    const techTotp = PILOT_TOTP.tech;
    const tech = await this.identity.createStaffUser({
      email: 'tech@pilot.miru.local',
      password,
      displayName: 'Пилотный внедряющий',
      organizationId: org.id,
      role: MembershipRole.TECH_IMPLEMENTATION,
    });
    await this.prisma.user.update({
      where: { id: tech.id },
      data: { totpSecret: techTotp, totpEnabled: true },
    });

    // Seed readiness for pilot org
    for (const tpl of ORG_READINESS_TEMPLATE) {
      await this.prisma.orgReadinessItem.upsert({
        where: {
          organizationId_key: { organizationId: org.id, key: tpl.key },
        },
        create: {
          organizationId: org.id,
          key: tpl.key,
          labelRu: tpl.labelRu,
          required: tpl.required,
          kind: tpl.kind,
          done: tpl.key === 'org_created',
          doneAt: tpl.key === 'org_created' ? new Date() : null,
        },
        update: {},
      });
    }

    const offer = await this.consent.publishDocument({
      kind: 'offer',
      version: '1.0',
      language: 'ru',
      body:
        'Публичная оферта об оказании дистанционных медицинских услуг. Версия 1.0. Текст для тестового контура.',
      organizationId: org.id,
    });

    const dmuConsent = await this.consent.publishDocument({
      kind: 'dmu_consent',
      version: '1.0',
      language: 'ru',
      body:
        'Информированное согласие на дистанционную медицинскую услугу. Версия 1.0. Пациент подтверждает понимание порядка оказания ДМУ.',
      organizationId: org.id,
    });

    const pmdConsent = await this.consent.publishDocument({
      kind: 'pmd_consent',
      version: '1.0',
      language: 'ru',
      body:
        'Информированное согласие на обработку персональных медицинских данных. Версия 1.0.',
      organizationId: org.id,
    });

    await this.prisma.catalogOffer.create({
      data: {
        organizationId: org.id,
        profileCode: 'therapy',
        titleRu: 'Терапия (ДМУ)',
        titleKk: 'Терапия (ҚМУ)',
        descriptionRu: 'Дистанционная консультация терапевта',
        descriptionKk: 'Терапевттің қашықтан консультациясы',
        durationMin: 30,
        active: true,
      },
    });

    const kiosk = await this.frontdesk.ensurePilotDevice(org.id);
    const slots = await this.scheduling.seedPilotAvailability(org.id, user.id);

    return {
      ok: true,
      organizationId: org.id,
      user: {
        email: 'consultant@pilot.miru.local',
        password,
        totpSecret,
        otpauthUri: totpOtpauthUri('consultant@pilot.miru.local', totpSecret),
        iin: CONSULTANT_IIN,
        note: 'Enroll TOTP (NFR 3.3). iin must match NCALayer cert for signing (TZ 9.3.3).',
      },
      tech: {
        email: 'tech@pilot.miru.local',
        password,
        totpSecret: techTotp,
        otpauthUri: totpOtpauthUri('tech@pilot.miru.local', techTotp),
        note: 'Admin panel (:5174) — no PMD access (TZ 11.2)',
      },
      consents: {
        offerId: offer.id,
        dmuConsentId: dmuConsent.id,
        pmdConsentId: pmdConsent.id,
      },
      frontdesk: {
        url: 'http://localhost:5177',
        deviceCode: kiosk.deviceCode,
        pairCode: kiosk.pairCode,
        deviceToken: kiosk.deviceToken,
        note: 'На :5177 — кнопка «Подключить пилотный терминал» или код PILOT1. Длинный token не нужен.',
      },
      slotsSeeded: slots.created,
    };
  }
}
