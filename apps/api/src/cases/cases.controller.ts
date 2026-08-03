import { Body, Controller, Get, Param, Post, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { CaseMode, CaseStatus, MembershipRole } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { isValidIin } from '@miru/shared';
import { CasesService } from './cases.service';
import { AuditPmd, CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';
import { DenyTechPmdGuard } from '../common/roles.guard';

class CreateCaseDto {
  @IsString()
  organizationId!: string;

  @IsString()
  @Length(12, 12)
  @Matches(/^\d{12}$/)
  patientIin!: string;

  @IsString()
  @Length(2, 256)
  patientFullName!: string;

  @IsOptional()
  @IsEnum(CaseMode)
  mode?: CaseMode;

  @IsOptional()
  @IsString()
  profileCode?: string;
}

class TransitionDto {
  @IsEnum(CaseStatus)
  toStatus!: CaseStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}

class AddParticipantDto {
  @IsString()
  userId!: string;

  @IsEnum(MembershipRole)
  role!: MembershipRole;
}

@Controller('cases')
@UseGuards(DenyTechPmdGuard)
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Get()
  @Roles(
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.CONSULTANT,
    MembershipRole.REGISTRAR,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
    MembershipRole.AUDITOR,
  )
  list(@CurrentUser() user: AuthUser, @Query('organizationId') organizationId: string) {
    return this.cases.listCases(user, organizationId);
  }

  @Post()
  @Roles(
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.CONSULTANT,
    MembershipRole.REGISTRAR,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
  )
  create(@CurrentUser() user: AuthUser, @Body() body: CreateCaseDto) {
    if (!isValidIin(body.patientIin)) {
      throw new BadRequestException('Invalid IIN checksum');
    }
    return this.cases.createCase(user, body);
  }

  @Get(':id')
  @AuditPmd({ objectType: 'case', action: 'view', idParam: 'id' })
  @Roles(
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.CONSULTANT,
    MembershipRole.REGISTRAR,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
    MembershipRole.AUDITOR,
  )
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cases.getCase(user, id);
  }

  @Post(':id/transition')
  @Roles(
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.CONSULTANT,
    MembershipRole.REGISTRAR,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
  )
  transition(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: TransitionDto,
  ) {
    return this.cases.transition(user, id, body.toStatus, body.reason);
  }

  @Post(':id/participants')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.REGISTRAR,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
    MembershipRole.AMBULATORY_WORKER,
  )
  addParticipant(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: AddParticipantDto,
  ) {
    return this.cases.addParticipant(user, id, body);
  }

  @Post(':id/async/submit')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
  )
  asyncSubmit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cases.submitAsyncForConclusion(user, id);
  }
}
