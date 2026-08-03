import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SchedulingService } from './scheduling.service';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';
import { DenyTechPmdGuard } from '../common/roles.guard';
import { UseGuards } from '@nestjs/common';

class UpsertScheduleDto {
  @IsString()
  organizationId!: string;

  @IsString()
  consultantUserId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek!: number;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  startTime!: string;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  endTime!: string;

  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(180)
  slotDurationMinutes!: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  breakStart?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  breakEnd?: string;
}

class GenerateSlotsDto {
  @IsString()
  organizationId!: string;

  @IsString()
  consultantUserId!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromDate!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toDate!: string;
}

class BookDto {
  @IsString()
  caseId!: string;

  @IsString()
  slotId!: string;
}

class ReasonDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}

class RescheduleDto {
  @IsString()
  newSlotId!: string;

  @IsString()
  @MinLength(3)
  reason!: string;
}

@Controller('scheduling')
@UseGuards(DenyTechPmdGuard)
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Post('schedules')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.REGISTRAR,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
  )
  upsert(@CurrentUser() user: AuthUser, @Body() body: UpsertScheduleDto) {
    return this.scheduling.upsertSchedule(user, body);
  }

  @Get('schedules')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.REGISTRAR,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
  )
  list(
    @CurrentUser() user: AuthUser,
    @Query('organizationId') organizationId: string,
    @Query('consultantUserId') consultantUserId?: string,
  ) {
    return this.scheduling.listSchedules(user, organizationId, consultantUserId);
  }

  @Post('slots/generate')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.REGISTRAR,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
  )
  generate(@CurrentUser() user: AuthUser, @Body() body: GenerateSlotsDto) {
    return this.scheduling.generateSlots(user, body);
  }

  @Get('slots')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.REGISTRAR,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
    MembershipRole.AMBULATORY_WORKER,
  )
  freeSlots(
    @CurrentUser() user: AuthUser,
    @Query('organizationId') organizationId: string,
    @Query('consultantUserId') consultantUserId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.scheduling.listFreeSlots(user, organizationId, consultantUserId, from, to);
  }

  @Post('slots/:id/block')
  @Roles(MembershipRole.REGISTRAR, MembershipRole.DEPARTMENT_HEAD, MembershipRole.ORG_ADMIN)
  block(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.scheduling.blockSlot(user, id, body.reason);
  }

  @Post('appointments/book')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.REGISTRAR,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
    MembershipRole.AMBULATORY_WORKER,
  )
  book(@CurrentUser() user: AuthUser, @Body() body: BookDto) {
    return this.scheduling.bookSlot(user, body);
  }

  @Post('appointments/:id/cancel')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.REGISTRAR,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
    MembershipRole.AMBULATORY_WORKER,
  )
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.scheduling.cancelAppointment(user, id, body.reason);
  }

  @Post('appointments/:id/reschedule')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.REGISTRAR,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
  )
  reschedule(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: RescheduleDto) {
    return this.scheduling.rescheduleAppointment(user, id, body.newSlotId, body.reason);
  }

  @Get('queue')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
    MembershipRole.REGISTRAR,
  )
  queue(
    @CurrentUser() user: AuthUser,
    @Query('organizationId') organizationId: string,
    @Query('profileCode') profileCode?: string,
  ) {
    return this.scheduling.listProfileQueue(user, organizationId, profileCode);
  }

  @Post('queue/claim')
  @Roles(MembershipRole.CONSULTANT)
  claim(
    @CurrentUser() user: AuthUser,
    @Body() body: { organizationId: string; profileCode: string },
  ) {
    return this.scheduling.claimNextProfileQueue(user, body.organizationId, body.profileCode);
  }
}
