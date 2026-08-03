import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { DossierService } from './dossier.service';
import { AuditPmd, CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';
import { DenyTechPmdGuard } from '../common/roles.guard';

@Controller('dossiers')
@UseGuards(DenyTechPmdGuard)
export class DossierController {
  constructor(private readonly dossiers: DossierService) {}

  @Post('cases/:caseId')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
    MembershipRole.AUDITOR,
    MembershipRole.REGISTRAR,
  )
  @AuditPmd({ objectType: 'dossier', action: 'assemble', idParam: 'caseId' })
  assemble(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.dossiers.assemble(user, caseId);
  }

  @Get('cases/:caseId/latest')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
    MembershipRole.AUDITOR,
    MembershipRole.REGISTRAR,
  )
  @AuditPmd({ objectType: 'dossier', action: 'view', idParam: 'caseId' })
  latest(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.dossiers.latest(user, caseId);
  }
}
