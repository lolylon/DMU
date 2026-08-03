import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipRole, SlotStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public витрина — only orgs with catalogPublic=true */
  async listPublicOrganizations() {
    return this.prisma.organization.findMany({
      where: { catalogPublic: true, status: { in: ['testing', 'live', 'onboarding'] } },
      select: {
        id: true,
        nameKk: true,
        nameRu: true,
        catalogCity: true,
        catalogAddress: true,
        status: true,
      },
      orderBy: { nameRu: 'asc' },
    });
  }

  async listPublicOffers(organizationId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId, catalogPublic: true },
      select: {
        id: true,
        nameRu: true,
        nameKk: true,
        catalogCity: true,
        catalogAddress: true,
      },
    });
    if (!org) throw new NotFoundException('Organization not in public catalog');

    const offers = await this.prisma.catalogOffer.findMany({
      where: { organizationId, active: true },
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

  async listPublicSlots(organizationId: string, fromIso: string, toIso: string, profileCode?: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId, catalogPublic: true },
    });
    if (!org) throw new NotFoundException('Organization not in public catalog');

    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid from/to');
    }

    const slots = await this.prisma.slot.findMany({
      where: {
        organizationId,
        startsAt: { gte: from, lte: to },
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

    void profileCode;
    return {
      organizationId,
      from: from.toISOString(),
      to: to.toISOString(),
      slots,
    };
  }

  async upsertOffer(
    actor: AuthUser,
    organizationId: string,
    input: {
      profileCode: string;
      titleRu: string;
      titleKk: string;
      descriptionRu?: string;
      descriptionKk?: string;
      durationMin?: number;
      active?: boolean;
    },
  ) {
    this.assertOrgAdmin(actor, organizationId);
    if (!input.profileCode.trim()) throw new BadRequestException('profileCode required');

    return this.prisma.catalogOffer.upsert({
      where: {
        organizationId_profileCode: {
          organizationId,
          profileCode: input.profileCode.trim(),
        },
      },
      create: {
        organizationId,
        profileCode: input.profileCode.trim(),
        titleRu: input.titleRu,
        titleKk: input.titleKk,
        descriptionRu: input.descriptionRu ?? '',
        descriptionKk: input.descriptionKk ?? '',
        durationMin: input.durationMin ?? 30,
        active: input.active ?? true,
      },
      update: {
        titleRu: input.titleRu,
        titleKk: input.titleKk,
        descriptionRu: input.descriptionRu ?? '',
        descriptionKk: input.descriptionKk ?? '',
        durationMin: input.durationMin ?? 30,
        active: input.active ?? true,
      },
    });
  }

  async setCatalogVisibility(
    actor: AuthUser,
    organizationId: string,
    input: { catalogPublic: boolean; catalogCity?: string; catalogAddress?: string },
  ) {
    this.assertOrgAdmin(actor, organizationId);
    return this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        catalogPublic: input.catalogPublic,
        catalogCity: input.catalogCity ?? null,
        catalogAddress: input.catalogAddress ?? null,
      },
      select: {
        id: true,
        catalogPublic: true,
        catalogCity: true,
        catalogAddress: true,
        nameRu: true,
      },
    });
  }

  async setMisMode(actor: AuthUser, organizationId: string, misMode: string) {
    this.assertOrgAdmin(actor, organizationId);
    if (!['manual', 'mock', 'zhetysu', 'damumed'].includes(misMode)) {
      throw new BadRequestException('misMode must be manual|mock|zhetysu|damumed');
    }
    return this.prisma.organization.update({
      where: { id: organizationId },
      data: { misMode },
      select: { id: true, misMode: true },
    });
  }

  private assertOrgAdmin(actor: AuthUser, organizationId: string) {
    const ok = actor.memberships.some(
      (m) =>
        m.organizationId === organizationId &&
        (m.role === MembershipRole.ORG_ADMIN ||
          m.role === MembershipRole.PLATFORM_ADMIN ||
          m.role === MembershipRole.TECH_IMPLEMENTATION ||
          m.role === MembershipRole.DEPARTMENT_HEAD),
    );
    if (!ok) throw new ForbiddenException('Org admin required');
  }
}
