import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { CatalogService } from './catalog.service';
import { CurrentUser, Public, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';

class OfferDto {
  @IsString()
  organizationId!: string;

  @IsString()
  @MinLength(1)
  profileCode!: string;

  @IsString()
  @MinLength(1)
  titleRu!: string;

  @IsString()
  @MinLength(1)
  titleKk!: string;

  @IsOptional()
  @IsString()
  descriptionRu?: string;

  @IsOptional()
  @IsString()
  descriptionKk?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  durationMin?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

class VisibilityDto {
  @IsString()
  organizationId!: string;

  @IsBoolean()
  catalogPublic!: boolean;

  @IsOptional()
  @IsString()
  catalogCity?: string;

  @IsOptional()
  @IsString()
  catalogAddress?: string;
}

class MisModeDto {
  @IsString()
  organizationId!: string;

  @IsString()
  misMode!: string;
}

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('organizations')
  listOrgs() {
    return this.catalog.listPublicOrganizations();
  }

  @Public()
  @Get('organizations/:id/offers')
  offers(@Param('id') id: string) {
    return this.catalog.listPublicOffers(id);
  }

  @Public()
  @Get('organizations/:id/slots')
  slots(
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('profileCode') profileCode?: string,
  ) {
    return this.catalog.listPublicSlots(id, from, to, profileCode);
  }

  @Post('offers')
  @Roles(
    MembershipRole.ORG_ADMIN,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.PLATFORM_ADMIN,
    MembershipRole.TECH_IMPLEMENTATION,
  )
  upsertOffer(@CurrentUser() user: AuthUser, @Body() body: OfferDto) {
    return this.catalog.upsertOffer(user, body.organizationId, body);
  }

  @Post('visibility')
  @Roles(
    MembershipRole.ORG_ADMIN,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.PLATFORM_ADMIN,
    MembershipRole.TECH_IMPLEMENTATION,
  )
  visibility(@CurrentUser() user: AuthUser, @Body() body: VisibilityDto) {
    return this.catalog.setCatalogVisibility(user, body.organizationId, body);
  }

  @Post('mis-mode')
  @Roles(
    MembershipRole.ORG_ADMIN,
    MembershipRole.PLATFORM_ADMIN,
    MembershipRole.TECH_IMPLEMENTATION,
  )
  misMode(@CurrentUser() user: AuthUser, @Body() body: MisModeDto) {
    return this.catalog.setMisMode(user, body.organizationId, body.misMode);
  }
}
