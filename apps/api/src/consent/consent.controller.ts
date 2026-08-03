import { Body, Controller, Get, Ip, Post, Query, UseGuards } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { ConsentService } from './consent.service';
import { CurrentUser, Public, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';
import { DenyTechPmdGuard } from '../common/roles.guard';

class PublishConsentDto {
  @IsString()
  kind!: string;

  @IsString()
  version!: string;

  @IsString()
  language!: string;

  @IsString()
  @MinLength(20)
  body!: string;

  @IsOptional()
  @IsString()
  organizationId?: string;
}

class AcceptConsentDto {
  @IsString()
  consentDocumentId!: string;

  @IsString()
  caseId!: string;

  @IsIn(['mini_app', 'sms', 'via_worker'])
  method!: 'mini_app' | 'sms' | 'via_worker';

  @IsOptional()
  @IsString()
  mediatorName?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}

@Controller('consents')
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Get('documents')
  @Public()
  list(@Query('kind') kind?: string) {
    return this.consent.listPublished(kind);
  }

  @Post('documents')
  @Roles(MembershipRole.ORG_ADMIN, MembershipRole.PLATFORM_ADMIN, MembershipRole.TECH_IMPLEMENTATION)
  publish(@Body() body: PublishConsentDto) {
    return this.consent.publishDocument(body);
  }

  @Post('accept')
  @UseGuards(DenyTechPmdGuard)
  @Roles(
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.CONSULTANT,
    MembershipRole.REGISTRAR,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
  )
  accept(@CurrentUser() user: AuthUser, @Body() body: AcceptConsentDto, @Ip() ip: string) {
    return this.consent.accept(user, { ...body, ip });
  }
}
