import { Body, Controller, ForbiddenException, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { IsInt, IsOptional, IsString, Length, Matches, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ConclusionService } from './conclusion.service';
import { AuditPmd, CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';
import { DenyTechPmdGuard } from '../common/roles.guard';

class DraftDto {
  @IsString()
  @MinLength(1)
  complaints!: string;

  @IsString()
  @MinLength(1)
  anamnesis!: string;

  @IsString()
  @MinLength(1)
  examination!: string;

  @IsString()
  @MinLength(1)
  conclusionText!: string;

  @IsString()
  @MinLength(1)
  recommendations!: string;

  @IsOptional()
  @IsString()
  authorPosition?: string;
}

class SignDto {
  @IsString()
  @MinLength(32)
  cmsBase64!: string;

  @IsString()
  @Length(12, 12)
  @Matches(/^\d{12}$/)
  signerIin!: string;

  @IsString()
  @Length(64, 64)
  contentHash!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  versionNumber!: number;
}

class DevSignDto {
  @IsString()
  @Length(12, 12)
  @Matches(/^\d{12}$/)
  signerIin!: string;
}

@Controller('conclusions')
@UseGuards(DenyTechPmdGuard)
export class ConclusionController {
  constructor(private readonly conclusions: ConclusionService) {}

  @Get('queue')
  @Roles(MembershipRole.CONSULTANT, MembershipRole.DEPARTMENT_HEAD)
  @AuditPmd({ objectType: 'conclusion', action: 'queue_list' })
  queue(@CurrentUser() user: AuthUser, @Query('organizationId') organizationId: string) {
    return this.conclusions.signingQueue(user, organizationId);
  }

  @Get('cases/:caseId')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
    MembershipRole.AUDITOR,
  )
  @AuditPmd({ objectType: 'conclusion', action: 'view', idParam: 'caseId' })
  getOne(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.conclusions.getForCase(user, caseId);
  }

  @Post('cases/:caseId/draft')
  @Roles(MembershipRole.CONSULTANT, MembershipRole.DEPARTMENT_HEAD)
  draft(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() body: DraftDto) {
    return this.conclusions.upsertDraft(user, caseId, body);
  }

  @Post('cases/:caseId/submit')
  @Roles(MembershipRole.CONSULTANT, MembershipRole.DEPARTMENT_HEAD)
  submit(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.conclusions.submitForSignature(user, caseId);
  }

  @Post('cases/:caseId/sign-challenge')
  @Roles(MembershipRole.CONSULTANT, MembershipRole.DEPARTMENT_HEAD)
  challenge(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.conclusions.prepareSignChallenge(user, caseId);
  }

  @Post('cases/:caseId/sign')
  @Roles(MembershipRole.CONSULTANT, MembershipRole.DEPARTMENT_HEAD)
  sign(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() body: SignDto) {
    return this.conclusions.applySignature(user, caseId, body);
  }

  @Post('cases/:caseId/sign-dev')
  @Roles(MembershipRole.CONSULTANT, MembershipRole.DEPARTMENT_HEAD)
  signDev(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string, @Body() body: DevSignDto) {
    return this.conclusions.applyDevSignature(user, caseId, body.signerIin);
  }

  @Get('cases/:caseId/document')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
    MembershipRole.AUDITOR,
  )
  @AuditPmd({ objectType: 'conclusion', action: 'document', idParam: 'caseId' })
  document(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.conclusions.documentUrl(user, caseId);
  }

  @Post('reminders')
  @Roles(MembershipRole.ORG_ADMIN, MembershipRole.DEPARTMENT_HEAD)
  reminders(@CurrentUser() user: AuthUser, @Query('organizationId') organizationId: string) {
    if (!user.memberships.some((m) => m.organizationId === organizationId)) {
      throw new ForbiddenException('No membership in organization');
    }
    return this.conclusions.enqueueSigningReminders(organizationId);
  }
}

@Controller('patient/conclusions')
export class PatientConclusionController {
  constructor(private readonly conclusions: ConclusionService) {}

  @Get(':caseId')
  @Roles(MembershipRole.PATIENT)
  @AuditPmd({ objectType: 'conclusion', action: 'patient_view', idParam: 'caseId' })
  get(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.conclusions.patientGetConclusion(user, caseId);
  }

  @Post(':caseId/confirm')
  @Roles(MembershipRole.PATIENT)
  confirm(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.conclusions.patientConfirmDelivery(user, caseId);
  }
}
