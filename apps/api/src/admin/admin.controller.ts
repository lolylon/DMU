import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AdminService } from './admin.service';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';

class CreateOrgDto {
  @IsString()
  @Length(12, 12)
  @Matches(/^\d{12}$/)
  bin!: string;

  @IsString()
  @MinLength(2)
  nameKk!: string;

  @IsString()
  @MinLength(2)
  nameRu!: string;

  @IsOptional()
  @IsString()
  misMode?: string;

  @IsOptional()
  @IsString()
  catalogCity?: string;

  @IsOptional()
  @IsString()
  catalogAddress?: string;
}

class DepartmentDto {
  @IsString()
  @MinLength(2)
  nameKk!: string;

  @IsString()
  @MinLength(2)
  nameRu!: string;
}

class CreateUserDto {
  @IsString()
  email!: string;

  @IsString()
  @MinLength(2)
  displayName!: string;

  @IsEnum(MembershipRole)
  role!: MembershipRole;

  @IsString()
  @MinLength(12)
  temporaryPassword!: string;

  @IsOptional()
  @IsString()
  @Length(12, 12)
  @Matches(/^\d{12}$/)
  iin?: string;
}

class BulkUserItemDto {
  @IsString()
  email!: string;

  @IsString()
  displayName!: string;

  @IsEnum(MembershipRole)
  role!: MembershipRole;

  @IsString()
  @MinLength(12)
  temporaryPassword!: string;

  @IsOptional()
  @IsString()
  iin?: string;
}

class BulkUsersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUserItemDto)
  users!: BulkUserItemDto[];
}

class SettingsDto {
  @IsOptional()
  @IsString()
  nameKk?: string;

  @IsOptional()
  @IsString()
  nameRu?: string;

  @IsOptional()
  @IsString()
  misMode?: string;

  @IsOptional()
  @IsBoolean()
  catalogPublic?: boolean;

  @IsOptional()
  @IsString()
  catalogCity?: string;

  @IsOptional()
  @IsString()
  catalogAddress?: string;
}

class ReadinessMarkDto {
  @IsBoolean()
  done!: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}

class StatusDto {
  @IsString()
  status!: string;
}

const TECH_ROLES = [
  MembershipRole.TECH_IMPLEMENTATION,
  MembershipRole.TECH_SUPPORT,
  MembershipRole.PLATFORM_ADMIN,
] as const;

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('orgs')
  @Roles(...TECH_ROLES)
  list(@CurrentUser() user: AuthUser) {
    return this.admin.listOrgs(user);
  }

  @Post('orgs')
  @Roles(MembershipRole.TECH_IMPLEMENTATION, MembershipRole.PLATFORM_ADMIN)
  create(@CurrentUser() user: AuthUser, @Body() body: CreateOrgDto) {
    return this.admin.createOrg(user, body);
  }

  @Get('orgs/:id')
  @Roles(...TECH_ROLES)
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.getOrg(user, id);
  }

  @Post('orgs/:id/departments')
  @Roles(MembershipRole.TECH_IMPLEMENTATION, MembershipRole.PLATFORM_ADMIN)
  department(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: DepartmentDto) {
    return this.admin.addDepartment(user, id, body);
  }

  @Post('orgs/:id/users')
  @Roles(MembershipRole.TECH_IMPLEMENTATION, MembershipRole.PLATFORM_ADMIN)
  user(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: CreateUserDto) {
    return this.admin.createUser(user, id, body);
  }

  @Post('orgs/:id/users/bulk')
  @Roles(MembershipRole.TECH_IMPLEMENTATION, MembershipRole.PLATFORM_ADMIN)
  bulk(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: BulkUsersDto) {
    return this.admin.bulkCreateUsers(user, id, body.users);
  }

  @Get('orgs/:id/members')
  @Roles(...TECH_ROLES)
  members(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.listMembers(user, id);
  }

  @Post('orgs/:id/consents/seed')
  @Roles(MembershipRole.TECH_IMPLEMENTATION, MembershipRole.PLATFORM_ADMIN)
  seedConsents(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.seedConsents(user, id);
  }

  @Post('orgs/:id/settings')
  @Roles(MembershipRole.TECH_IMPLEMENTATION, MembershipRole.PLATFORM_ADMIN)
  settings(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: SettingsDto) {
    return this.admin.updateSettings(user, id, body);
  }

  @Get('orgs/:id/readiness')
  @Roles(...TECH_ROLES)
  readiness(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.admin.assertTech(user);
    return this.admin.evaluateReadiness(id);
  }

  @Post('orgs/:id/readiness/:key')
  @Roles(MembershipRole.TECH_IMPLEMENTATION, MembershipRole.PLATFORM_ADMIN)
  mark(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('key') key: string,
    @Body() body: ReadinessMarkDto,
  ) {
    return this.admin.markReadiness(user, id, key, body.done, body.note);
  }

  @Post('orgs/:id/status')
  @Roles(MembershipRole.TECH_IMPLEMENTATION, MembershipRole.PLATFORM_ADMIN)
  status(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: StatusDto) {
    return this.admin.setStatus(user, id, body.status);
  }

  @Get('tech-actions')
  @Roles(...TECH_ROLES)
  techActions(@CurrentUser() user: AuthUser, @Query('organizationId') organizationId?: string) {
    return this.admin.listTechActions(user, organizationId);
  }
}
