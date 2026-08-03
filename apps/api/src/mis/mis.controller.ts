import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { MisService } from './mis.service';
import { AuditPmd, CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';
import { DenyTechPmdGuard } from '../common/roles.guard';

class ReferralDto {
  @IsString()
  @MinLength(1)
  referralNumber!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

@Controller('mis')
@UseGuards(DenyTechPmdGuard)
export class MisController {
  constructor(private readonly mis: MisService) {}

  @Get('dashboard')
  @Roles(
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
    MembershipRole.REGISTRAR,
    MembershipRole.AUDITOR,
    MembershipRole.CONSULTANT,
  )
  dashboard(@CurrentUser() user: AuthUser, @Query('organizationId') organizationId: string) {
    return this.mis.orgDashboard(user, organizationId);
  }

  @Get('registry')
  @Roles(
    MembershipRole.REGISTRAR,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
    MembershipRole.AUDITOR,
  )
  @AuditPmd({ objectType: 'mis_registry', action: 'list' })
  registry(
    @CurrentUser() user: AuthUser,
    @Query('organizationId') organizationId: string,
    @Query('day') day: string,
  ) {
    return this.mis.dailyRegistry(user, organizationId, day || new Date().toISOString().slice(0, 10));
  }

  @Get('cases/:caseId')
  @Roles(
    MembershipRole.REGISTRAR,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
    MembershipRole.CONSULTANT,
  )
  bridge(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.mis.getBridgeForCase(user, caseId);
  }

  @Post('cases/:caseId/referral')
  @Roles(MembershipRole.REGISTRAR, MembershipRole.DEPARTMENT_HEAD, MembershipRole.ORG_ADMIN)
  referral(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() body: ReferralDto) {
    return this.mis.setReferral(user, caseId, body.referralNumber, body.notes);
  }

  @Post('cases/:caseId/entered')
  @Roles(MembershipRole.REGISTRAR, MembershipRole.DEPARTMENT_HEAD, MembershipRole.ORG_ADMIN)
  entered(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.mis.markEnteredInMis(user, caseId);
  }

  @Post('cases/:caseId/enqueue')
  @Roles(
    MembershipRole.REGISTRAR,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
    MembershipRole.CONSULTANT,
  )
  enqueue(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.mis.enqueueCaseCompleted(caseId, user.id);
  }
}
