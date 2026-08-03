import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { validatePasswordPolicy } from '@miru/shared';
import { AdminPrismaService } from '../prisma/admin-prisma.service';
import { IdentityService } from '../identity/identity.service';
import { ConsentService } from '../consent/consent.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/decorators';
import { ORG_READINESS_TEMPLATE } from './readiness.template';
import { hashIin } from '../common/crypto';

const STAFF_ROLES: MembershipRole[] = [
  MembershipRole.AMBULATORY_WORKER,
  MembershipRole.CONSULTANT,
  MembershipRole.REGISTRAR,
  MembershipRole.DEPARTMENT_HEAD,
  MembershipRole.ORG_ADMIN,
  MembershipRole.AUDITOR,
];

@Injectable()
export class AdminService {
  constructor(
    /** miru_admin role — no SQL grants on PMD content tables (§4.3) */
    private readonly prisma: AdminPrismaService,
    private readonly identity: IdentityService,
    private readonly consent: ConsentService,
    private readonly audit: AuditService,
  ) {}

  assertTech(actor: AuthUser) {
    const ok = actor.memberships.some((m) =>
      (
        [
          MembershipRole.TECH_IMPLEMENTATION,
          MembershipRole.TECH_SUPPORT,
          MembershipRole.PLATFORM_ADMIN,
        ] as MembershipRole[]
      ).includes(m.role),
    );
    if (!ok) throw new ForbiddenException('Tech/platform role required');
  }

  async listOrgs(actor: AuthUser) {
    this.assertTech(actor);
    return this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        bin: true,
        nameKk: true,
        nameRu: true,
        status: true,
        misMode: true,
        catalogPublic: true,
        catalogCity: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { memberships: true, departments: true } },
      },
    });
  }

  async createOrg(
    actor: AuthUser,
    input: {
      bin: string;
      nameKk: string;
      nameRu: string;
      misMode?: string;
      catalogCity?: string;
      catalogAddress?: string;
    },
  ) {
    this.assertTech(actor);
    if (!/^\d{12}$/.test(input.bin)) throw new BadRequestException('BIN must be 12 digits');

    const org = await this.prisma.organization.create({
      data: {
        bin: input.bin,
        nameKk: input.nameKk,
        nameRu: input.nameRu,
        status: 'onboarding',
        misMode: input.misMode ?? 'manual',
        catalogCity: input.catalogCity ?? null,
        catalogAddress: input.catalogAddress ?? null,
        catalogPublic: false,
      },
    });

    await this.seedReadiness(org.id);
    await this.audit.logTechAction(actor.id, 'org_create', org.id, {
      bin: org.bin,
      nameRu: org.nameRu,
    });

    return this.getOrg(actor, org.id);
  }

  async getOrg(actor: AuthUser, organizationId: string) {
    this.assertTech(actor);
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        bin: true,
        nameKk: true,
        nameRu: true,
        status: true,
        misMode: true,
        catalogPublic: true,
        catalogCity: true,
        catalogAddress: true,
        createdAt: true,
        updatedAt: true,
        departments: { select: { id: true, nameKk: true, nameRu: true, createdAt: true } },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const readiness = await this.evaluateReadiness(organizationId);
    const members = await this.listMembers(actor, organizationId);

    return { ...org, readiness, members };
  }

  async addDepartment(
    actor: AuthUser,
    organizationId: string,
    input: { nameKk: string; nameRu: string },
  ) {
    this.assertTech(actor);
    await this.requireOrg(organizationId);
    const dep = await this.prisma.department.create({
      data: {
        organizationId,
        nameKk: input.nameKk,
        nameRu: input.nameRu,
      },
    });
    await this.audit.logTechAction(actor.id, 'department_create', organizationId, {
      departmentId: dep.id,
      nameRu: dep.nameRu,
    });
    return dep;
  }

  async createUser(
    actor: AuthUser,
    organizationId: string,
    input: {
      email: string;
      displayName: string;
      role: MembershipRole;
      temporaryPassword: string;
      iin?: string;
    },
  ) {
    this.assertTech(actor);
    await this.requireOrg(organizationId);
    if (!STAFF_ROLES.includes(input.role)) {
      throw new BadRequestException(`Role not allowed for bulk staff: ${input.role}`);
    }
    const policy = validatePasswordPolicy(input.temporaryPassword);
    if (policy) throw new BadRequestException(policy);

    const user = await this.identity.createStaffUser({
      email: input.email,
      password: input.temporaryPassword,
      displayName: input.displayName,
      organizationId,
      role: input.role,
    });

    if (input.iin) {
      if (!/^\d{12}$/.test(input.iin)) throw new BadRequestException('IIN must be 12 digits');
      await this.prisma.user.update({
        where: { id: user.id },
        data: { iinHash: hashIin(input.iin) },
      });
    }

    await this.audit.logTechAction(actor.id, 'user_create', organizationId, {
      userId: user.id,
      email: user.email,
      role: input.role,
      // never log password
    });

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: input.role,
      totpEnabled: false,
      note: 'User must enroll TOTP before clinical work (NFR 3.3)',
    };
  }

  async bulkCreateUsers(
    actor: AuthUser,
    organizationId: string,
    users: Array<{
      email: string;
      displayName: string;
      role: MembershipRole;
      temporaryPassword: string;
      iin?: string;
    }>,
  ) {
    this.assertTech(actor);
    if (!users?.length) throw new BadRequestException('users array required');
    if (users.length > 200) throw new BadRequestException('Max 200 users per bulk');

    const results: Array<{ email: string; ok: boolean; id?: string; error?: string }> = [];
    for (const u of users) {
      try {
        const created = await this.createUser(actor, organizationId, u);
        results.push({ email: u.email, ok: true, id: created.id });
      } catch (e) {
        results.push({
          email: u.email,
          ok: false,
          error: e instanceof Error ? e.message : 'failed',
        });
      }
    }

    await this.audit.logTechAction(actor.id, 'user_bulk_import', organizationId, {
      total: users.length,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    });

    return { results };
  }

  async listMembers(actor: AuthUser, organizationId: string) {
    this.assertTech(actor);
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            totpEnabled: true,
            isBlocked: true,
            createdAt: true,
            // no iinHash plaintext; hash not needed in admin UI
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      membershipId: m.id,
      role: m.role,
      userId: m.user.id,
      email: m.user.email,
      displayName: m.user.displayName,
      totpEnabled: m.user.totpEnabled,
      isBlocked: m.user.isBlocked,
      createdAt: m.user.createdAt,
    }));
  }

  async seedConsents(actor: AuthUser, organizationId: string) {
    this.assertTech(actor);
    await this.requireOrg(organizationId);

    const docs = [
      {
        kind: 'offer',
        body: 'Публичная оферта об оказании дистанционных медицинских услуг. Версия 1.0.',
      },
      {
        kind: 'dmu_consent',
        body: 'Информированное согласие на дистанционную медицинскую услугу. Версия 1.0.',
      },
      {
        kind: 'pmd_consent',
        body: 'Информированное согласие на обработку персональных медицинских данных. Версия 1.0.',
      },
    ];

    const created = [];
    for (const d of docs) {
      const existing = await this.prisma.consentDocument.findFirst({
        where: { organizationId, kind: d.kind, version: '1.0', language: 'ru' },
      });
      if (existing) {
        created.push(existing);
        continue;
      }
      created.push(
        await this.consent.publishDocument({
          kind: d.kind,
          version: '1.0',
          language: 'ru',
          body: d.body,
          organizationId,
        }),
      );
    }

    await this.audit.logTechAction(actor.id, 'consents_seed', organizationId, {
      count: created.length,
      kinds: created.map((c) => c.kind),
    });

    return created.map((c) => ({
      id: c.id,
      kind: c.kind,
      version: c.version,
      language: c.language,
      contentHash: c.contentHash,
      publishedAt: c.publishedAt,
    }));
  }

  async updateSettings(
    actor: AuthUser,
    organizationId: string,
    input: {
      nameKk?: string;
      nameRu?: string;
      misMode?: string;
      catalogPublic?: boolean;
      catalogCity?: string;
      catalogAddress?: string;
    },
  ) {
    this.assertTech(actor);
    await this.requireOrg(organizationId);
    if (input.misMode && !['manual', 'mock', 'zhetysu', 'damumed'].includes(input.misMode)) {
      throw new BadRequestException('Invalid misMode');
    }

    const org = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        nameKk: input.nameKk,
        nameRu: input.nameRu,
        misMode: input.misMode,
        catalogPublic: input.catalogPublic,
        catalogCity: input.catalogCity,
        catalogAddress: input.catalogAddress,
      },
      select: {
        id: true,
        nameRu: true,
        misMode: true,
        catalogPublic: true,
        catalogCity: true,
        catalogAddress: true,
        status: true,
      },
    });

    await this.audit.logTechAction(actor.id, 'org_settings_update', organizationId, input);
    return org;
  }

  async markReadiness(
    actor: AuthUser,
    organizationId: string,
    key: string,
    done: boolean,
    note?: string,
  ) {
    this.assertTech(actor);
    const item = await this.prisma.orgReadinessItem.findUnique({
      where: { organizationId_key: { organizationId, key } },
    });
    if (!item) throw new NotFoundException('Readiness item not found');
    if (item.kind !== 'manual') {
      throw new BadRequestException('Auto items are computed — cannot mark manually');
    }

    const updated = await this.prisma.orgReadinessItem.update({
      where: { id: item.id },
      data: {
        done,
        doneAt: done ? new Date() : null,
        doneByUserId: done ? actor.id : null,
        note: note ?? item.note,
      },
    });

    await this.audit.logTechAction(actor.id, 'readiness_mark', organizationId, {
      key,
      done,
    });
    return updated;
  }

  /**
   * Gate: testing/live only if all required readiness items are done.
   */
  async setStatus(actor: AuthUser, organizationId: string, status: string) {
    this.assertTech(actor);
    if (!['onboarding', 'testing', 'live', 'suspended'].includes(status)) {
      throw new BadRequestException('Invalid status');
    }

    const readiness = await this.evaluateReadiness(organizationId);
    if ((status === 'testing' || status === 'live') && !readiness.allRequiredDone) {
      throw new BadRequestException({
        message: 'Readiness checklist gate failed — complete required items first',
        missing: readiness.items.filter((i) => i.required && !i.done).map((i) => i.key),
      });
    }

    const org = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { status },
      select: { id: true, status: true, nameRu: true },
    });

    await this.audit.logTechAction(actor.id, 'org_status_change', organizationId, {
      status,
      readinessOk: readiness.allRequiredDone,
    });

    return { ...org, readiness };
  }

  async listTechActions(actor: AuthUser, organizationId?: string) {
    this.assertTech(actor);
    return this.prisma.techActionLog.findMany({
      where: organizationId ? { organizationId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async evaluateReadiness(organizationId: string) {
    await this.seedReadiness(organizationId);

    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: {
        departments: { select: { id: true } },
        memberships: { select: { role: true } },
        readinessItems: true,
      },
    });

    const consents = await this.prisma.consentDocument.findMany({
      where: { organizationId },
      select: { kind: true },
    });
    const kinds = new Set(consents.map((c) => c.kind));
    const scheduleCount = await this.prisma.consultantSchedule.count({ where: { organizationId } });
    const offerCount = await this.prisma.catalogOffer.count({
      where: { organizationId, active: true },
    });

    const autoDone: Record<string, boolean> = {
      org_created: true,
      department_created: org.departments.length > 0,
      org_admin_user: org.memberships.some((m) => m.role === MembershipRole.ORG_ADMIN),
      consultant_user: org.memberships.some((m) => m.role === MembershipRole.CONSULTANT),
      consent_offer: kinds.has('offer'),
      consent_dmu: kinds.has('dmu_consent'),
      consent_pmd: kinds.has('pmd_consent'),
      mis_mode_set: Boolean(org.misMode),
      schedule_exists: scheduleCount > 0,
      catalog_offer: offerCount > 0,
    };

    const items = [];
    for (const tpl of ORG_READINESS_TEMPLATE) {
      const row = org.readinessItems.find((r) => r.key === tpl.key);
      const done = tpl.kind === 'auto' ? Boolean(autoDone[tpl.key]) : Boolean(row?.done);
      if (row && tpl.kind === 'auto' && row.done !== done) {
        await this.prisma.orgReadinessItem.update({
          where: { id: row.id },
          data: { done, doneAt: done ? new Date() : null },
        });
      }
      items.push({
        key: tpl.key,
        labelRu: tpl.labelRu,
        required: tpl.required,
        kind: tpl.kind,
        done,
        doneAt: tpl.kind === 'manual' ? row?.doneAt ?? null : done ? new Date() : null,
        note: row?.note ?? null,
      });
    }

    const required = items.filter((i) => i.required);
    const allRequiredDone = required.every((i) => i.done);

    return {
      allRequiredDone,
      requiredTotal: required.length,
      requiredDone: required.filter((i) => i.done).length,
      items,
      canGoTesting: allRequiredDone,
      canGoLive: allRequiredDone,
    };
  }

  private async seedReadiness(organizationId: string) {
    for (const tpl of ORG_READINESS_TEMPLATE) {
      await this.prisma.orgReadinessItem.upsert({
        where: {
          organizationId_key: { organizationId, key: tpl.key },
        },
        create: {
          organizationId,
          key: tpl.key,
          labelRu: tpl.labelRu,
          required: tpl.required,
          kind: tpl.kind,
          done: tpl.key === 'org_created',
          doneAt: tpl.key === 'org_created' ? new Date() : null,
        },
        update: {
          labelRu: tpl.labelRu,
          required: tpl.required,
          kind: tpl.kind,
        },
      });
    }
  }

  private async requireOrg(organizationId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }
}
