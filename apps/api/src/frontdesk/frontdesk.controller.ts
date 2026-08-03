import { Body, Controller, Get, Ip, Param, Post, Query, Headers, UseGuards } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';
import { FrontdeskService } from './frontdesk.service';
import { CurrentKiosk, KioskRoute } from './kiosk.decorators';
import type { KioskContext } from './kiosk.decorators';
import { KioskGuard } from './kiosk.guard';
import { CurrentUser, Public, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';

class RegisterDeviceDto {
  @IsString()
  organizationId!: string;

  @IsString()
  @MinLength(2)
  label!: string;

  @IsOptional()
  @IsBoolean()
  emergencyEnabled?: boolean;

  @IsOptional()
  @IsString()
  otaChannel?: string;
}

class RequestCodeDto {
  @IsString()
  @Length(12, 12)
  @Matches(/^\d{12}$/)
  iin!: string;
}

class VerifyDto {
  @IsString()
  @Length(12, 12)
  @Matches(/^\d{12}$/)
  iin!: string;

  @IsString()
  @MinLength(4)
  code!: string;
}

class VersionDto {
  @IsString()
  @MinLength(1)
  appVersion!: string;
}

class StartBookingDto {
  @IsString()
  @MinLength(2)
  patientFullName!: string;

  @IsString()
  @MinLength(1)
  profileCode!: string;
}

class AcceptConsentDto {
  @IsString()
  consentDocumentId!: string;
}

class BookDto {
  @IsString()
  slotId!: string;
}

class CancelApptDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

class EmergencyDto {
  @IsOptional()
  @IsString()
  note?: string;
}

class PublishReleaseDto {
  @IsString()
  channel!: string;

  @IsString()
  version!: string;

  @IsOptional()
  @IsString()
  downloadUrl?: string;

  @IsOptional()
  @IsString()
  checksumSha256?: string;

  @IsOptional()
  @IsString()
  notesRu?: string;

  @IsOptional()
  @IsBoolean()
  mandatory?: boolean;
}

class ClaimPairDto {
  @IsOptional()
  @IsString()
  @MinLength(4)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(32)
  deviceToken?: string;
}

@Controller('frontdesk')
@UseGuards(KioskGuard)
export class FrontdeskController {
  constructor(private readonly frontdesk: FrontdeskService) {}

  @Post('devices')
  @Roles(
    MembershipRole.ORG_ADMIN,
    MembershipRole.TECH_IMPLEMENTATION,
    MembershipRole.PLATFORM_ADMIN,
  )
  register(@CurrentUser() user: AuthUser, @Body() body: RegisterDeviceDto) {
    return this.frontdesk.registerDevice(user, body);
  }

  @Post('devices/:id/pair-code')
  @Roles(
    MembershipRole.ORG_ADMIN,
    MembershipRole.TECH_IMPLEMENTATION,
    MembershipRole.PLATFORM_ADMIN,
  )
  refreshPairCode(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.frontdesk.refreshPairCode(user, id);
  }

  /** Public: terminal exchanges short pair code (or legacy long token) → stores bearer locally. */
  @Public()
  @Post('pair')
  claimPair(@Body() body: ClaimPairDto) {
    return this.frontdesk.claimPair(body);
  }

  @Public()
  @KioskRoute()
  @Get('me')
  me(@CurrentKiosk() kiosk: KioskContext) {
    return this.frontdesk.deviceMe(kiosk);
  }

  @Public()
  @KioskRoute()
  @Post('ota/report')
  otaReport(@CurrentKiosk() kiosk: KioskContext, @Body() body: VersionDto) {
    return this.frontdesk.reportVersion(kiosk, body.appVersion);
  }

  @Public()
  @KioskRoute()
  @Get('ota/check')
  otaCheck(@CurrentKiosk() kiosk: KioskContext, @Query('version') version: string) {
    return this.frontdesk.checkOta(kiosk, version || '0.0.0');
  }

  @Public()
  @KioskRoute()
  @Post('auth/request-code')
  requestCode(@Body() body: RequestCodeDto, @Ip() ip: string) {
    return this.frontdesk.requestCode(body.iin, ip);
  }

  @Public()
  @KioskRoute()
  @Post('auth/verify')
  verify(
    @Body() body: VerifyDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.frontdesk.verifyCode({
      iin: body.iin,
      code: body.code,
      ip,
      userAgent,
    });
  }

  @Public()
  @KioskRoute()
  @Get('offers')
  offers(@CurrentKiosk() kiosk: KioskContext) {
    return this.frontdesk.listOffers(kiosk);
  }

  @Public()
  @KioskRoute()
  @Get('slots')
  slots(
    @CurrentKiosk() kiosk: KioskContext,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('profileCode') profileCode?: string,
  ) {
    return this.frontdesk.listSlots(kiosk, from, to, profileCode);
  }

  @KioskRoute()
  @Roles(MembershipRole.PATIENT)
  @Post('booking/start')
  start(
    @CurrentKiosk() kiosk: KioskContext,
    @CurrentUser() user: AuthUser,
    @Body() body: StartBookingDto,
  ) {
    return this.frontdesk.startBooking(kiosk, user, body);
  }

  @KioskRoute()
  @Roles(MembershipRole.PATIENT)
  @Post('cases/:id/consents/accept')
  accept(
    @CurrentKiosk() kiosk: KioskContext,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: AcceptConsentDto,
    @Ip() ip: string,
  ) {
    return this.frontdesk.acceptConsent(kiosk, user, id, body.consentDocumentId, ip);
  }

  @KioskRoute()
  @Roles(MembershipRole.PATIENT)
  @Post('cases/:id/book')
  book(
    @CurrentKiosk() kiosk: KioskContext,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: BookDto,
  ) {
    return this.frontdesk.bookSlot(kiosk, user, id, body.slotId);
  }

  @KioskRoute()
  @Roles(MembershipRole.PATIENT)
  @Get('appointments')
  myAppointments(@CurrentKiosk() kiosk: KioskContext, @CurrentUser() user: AuthUser) {
    return this.frontdesk.listMyAppointments(kiosk, user);
  }

  @KioskRoute()
  @Roles(MembershipRole.PATIENT)
  @Post('appointments/:id/cancel')
  cancelAppt(
    @CurrentKiosk() kiosk: KioskContext,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: CancelApptDto,
  ) {
    return this.frontdesk.cancelMyAppointment(kiosk, user, id, body.reason ?? 'Отмена на киоске');
  }

  @Public()
  @KioskRoute()
  @Post('emergency')
  emergency(@CurrentKiosk() kiosk: KioskContext, @Body() body: EmergencyDto) {
    return this.frontdesk.raiseEmergency(kiosk, body.note);
  }

  @Get('emergencies')
  @Roles(
    MembershipRole.REGISTRAR,
    MembershipRole.ORG_ADMIN,
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.TECH_SUPPORT,
    MembershipRole.PLATFORM_ADMIN,
  )
  listEmergencies(
    @CurrentUser() user: AuthUser,
    @Query('organizationId') organizationId: string,
  ) {
    return this.frontdesk.listOpenEmergencies(user, organizationId);
  }

  @Post('emergencies/:id/ack')
  @Roles(
    MembershipRole.REGISTRAR,
    MembershipRole.ORG_ADMIN,
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.TECH_SUPPORT,
    MembershipRole.PLATFORM_ADMIN,
  )
  ack(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.frontdesk.ackEmergency(user, id);
  }

  @Post('releases')
  @Roles(
    MembershipRole.TECH_IMPLEMENTATION,
    MembershipRole.TECH_SUPPORT,
    MembershipRole.PLATFORM_ADMIN,
  )
  publish(@CurrentUser() user: AuthUser, @Body() body: PublishReleaseDto) {
    return this.frontdesk.publishRelease(user, body);
  }
}
