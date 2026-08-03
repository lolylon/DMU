import { BadRequestException, Controller, Post } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { authenticator } from 'otplib';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from '../identity/identity.service';
import { ConsentService } from '../consent/consent.service';
import { hashIin } from '../common/crypto';
import { ORG_READINESS_TEMPLATE } from '../admin/readiness.template';

/** Valid test IIN for pilot consultant (ЭЦП bind, TZ 9.3.3) */
const CONSULTANT_IIN = '880101300000';

/**
 * Dev/test bootstrap only. Disabled unless ALLOW_BOOTSTRAP=true.
 * Never enable in production (NFR 12.5 — no known test passwords in prod).
 */
@Controller('bootstrap')
export class BootstrapController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly consent: ConsentService,
  ) {}

  @Public()
  @Post('demo')
  async demo() {
    if (process.env.ALLOW_BOOTSTRAP !== 'true') {
      throw new BadRequestException('Bootstrap disabled');
    }

    const existing = await this.prisma.organization.findUnique({
      where: { bin: '123456789012' },
    });
    if (existing) {
      const consultantTotp = authenticator.generateSecret();
      const techTotp = authenticator.generateSecret();
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
      const awTotp = authenticator.generateSecret();
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

      return {
        ok: true,
        message: 'Already bootstrapped — TOTP secrets rotated (dev only)',
        organizationId: existing.id,
        consultantIin: CONSULTANT_IIN,
        password,
        howToTotp:
          'Добавь ключ totpSecret в Google Authenticator (Time-based). Код 6 цифр меняется каждые 30 сек.',
        consultant: {
          email: 'consultant@pilot.miru.local',
          password,
          totpSecret: consultantTotp,
          url: 'http://localhost:5173',
        },
        ambulatory: {
          email: 'ambulatory@pilot.miru.local',
          password,
          totpSecret: awTotp,
          url: 'http://localhost:5173',
        },
        tech: {
          email: 'tech@pilot.miru.local',
          password,
          totpSecret: techTotp,
          url: 'http://localhost:5174',
        },
        patient: {
          iin: '900000000009',
          url: 'http://localhost:5175',
          note: 'Код придёт в ответе request-code (debugCode) при ALLOW_BOOTSTRAP',
        },
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
    const totpSecret = authenticator.generateSecret();
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

    const techTotp = authenticator.generateSecret();
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

    return {
      ok: true,
      organizationId: org.id,
      user: {
        email: 'consultant@pilot.miru.local',
        password,
        totpSecret,
        iin: CONSULTANT_IIN,
        note: 'Enroll TOTP (NFR 3.3). iin must match NCALayer cert for signing (TZ 9.3.3).',
      },
      tech: {
        email: 'tech@pilot.miru.local',
        password,
        totpSecret: techTotp,
        note: 'Admin panel (:5174) — no PMD access (TZ 11.2)',
      },
      consents: {
        offerId: offer.id,
        dmuConsentId: dmuConsent.id,
        pmdConsentId: pmdConsent.id,
      },
    };
  }
}
