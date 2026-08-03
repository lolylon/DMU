import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenancyService {
  constructor(private readonly prisma: PrismaService) {}

  listOrganizations(actor?: { memberships: { organizationId: string; role: string }[] }) {
    const tech = actor?.memberships.some((m) =>
      ['TECH_IMPLEMENTATION', 'TECH_SUPPORT', 'PLATFORM_ADMIN'].includes(m.role),
    );
    const orgIds = actor?.memberships.map((m) => m.organizationId) ?? [];

    return this.prisma.organization.findMany({
      where: tech || !actor ? undefined : { id: { in: orgIds } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        bin: true,
        nameKk: true,
        nameRu: true,
        status: true,
        misMode: true,
        catalogPublic: true,
        createdAt: true,
      },
    });
  }

  createOrganization(input: { bin: string; nameKk: string; nameRu: string }) {
    return this.prisma.organization.create({
      data: {
        bin: input.bin,
        nameKk: input.nameKk,
        nameRu: input.nameRu,
        status: 'onboarding',
      },
    });
  }
}
