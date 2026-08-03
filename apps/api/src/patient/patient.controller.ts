import { Body, Controller, Get, Ip, Param, Post, Query, Headers } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';
import { PatientService } from './patient.service';
import { CurrentUser, Public, Roles, AuditPmd } from '../common/decorators';
import type { AuthUser } from '../common/decorators';

class RequestCodeDto {
  @IsString()
  @Length(12, 12)
  @Matches(/^\d{12}$/)
  iin!: string;
}

class VerifyCodeDto {
  @IsString()
  @Length(12, 12)
  @Matches(/^\d{12}$/)
  iin!: string;

  @IsString()
  @MinLength(4)
  code!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{5,20}$/)
  telegramChatId?: string;
}

class BindTelegramDto {
  @IsString()
  @Matches(/^\d{5,20}$/)
  telegramChatId!: string;
}

class AcceptConsentDto {
  @IsString()
  consentDocumentId!: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}

class BookSlotDto {
  @IsString()
  slotId!: string;
}

class StartCatalogDto {
  @IsString()
  organizationId!: string;

  @IsString()
  @MinLength(1)
  profileCode!: string;

  @IsString()
  @MinLength(2)
  patientFullName!: string;
}

class CancelApptDto {
  @IsString()
  @MinLength(2)
  reason!: string;
}

@Controller('patient')
export class PatientController {
  constructor(private readonly patient: PatientService) {}

  @Public()
  @Post('auth/request-code')
  requestCode(@Body() body: RequestCodeDto, @Ip() ip: string) {
    return this.patient.requestCode(body.iin, ip);
  }

  @Public()
  @Post('auth/verify')
  verify(
    @Body() body: VerifyCodeDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.patient.verifyCode({
      iin: body.iin,
      code: body.code,
      ip,
      userAgent,
      telegramChatId: body.telegramChatId,
    });
  }

  @Post('me/telegram')
  @Roles(MembershipRole.PATIENT)
  bindTelegram(@CurrentUser() user: AuthUser, @Body() body: BindTelegramDto) {
    return this.patient.bindTelegramChat(user, body.telegramChatId);
  }

  @Get('cases')
  @Roles(MembershipRole.PATIENT)
  listCases(@CurrentUser() user: AuthUser) {
    return this.patient.listMyCases(user);
  }

  @Post('cases/from-catalog')
  @Roles(MembershipRole.PATIENT)
  fromCatalog(@CurrentUser() user: AuthUser, @Body() body: StartCatalogDto) {
    return this.patient.startFromCatalog(user, body);
  }

  @Get('cases/:id')
  @Roles(MembershipRole.PATIENT)
  @AuditPmd({ objectType: 'case', action: 'patient_view', idParam: 'id' })
  getCase(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.patient.getMyCase(user, id);
  }

  @Post('cases/:id/consents/accept')
  @Roles(MembershipRole.PATIENT)
  accept(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: AcceptConsentDto,
    @Ip() ip: string,
  ) {
    return this.patient.acceptConsent(user, id, body.consentDocumentId, body.deviceId, ip);
  }

  @Get('cases/:id/slots')
  @Roles(MembershipRole.PATIENT)
  slots(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.patient.listSlotsForCase(user, id, from, to);
  }

  @Post('cases/:id/book')
  @Roles(MembershipRole.PATIENT)
  book(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: BookSlotDto) {
    return this.patient.bookSlot(user, id, body.slotId);
  }

  @Post('appointments/:id/cancel')
  @Roles(MembershipRole.PATIENT)
  cancelAppt(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: CancelApptDto,
  ) {
    return this.patient.cancelAppointment(user, id, body.reason);
  }
}
