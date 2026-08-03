import { Body, Controller, Get, Post } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { IsString, Length, Matches } from 'class-validator';
import { TenancyService } from './tenancy.service';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';

class CreateOrganizationDto {
  @IsString()
  @Length(12, 12)
  @Matches(/^\d{12}$/)
  bin!: string;

  @IsString()
  @Length(2, 256)
  nameKk!: string;

  @IsString()
  @Length(2, 256)
  nameRu!: string;
}

@Controller('organizations')
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get()
  @Roles(
    MembershipRole.TECH_IMPLEMENTATION,
    MembershipRole.TECH_SUPPORT,
    MembershipRole.PLATFORM_ADMIN,
    MembershipRole.ORG_ADMIN,
  )
  list(@CurrentUser() user: AuthUser) {
    return this.tenancy.listOrganizations(user);
  }

  @Post()
  @Roles(MembershipRole.TECH_IMPLEMENTATION, MembershipRole.PLATFORM_ADMIN)
  create(@Body() body: CreateOrganizationDto) {
    return this.tenancy.createOrganization(body);
  }
}
