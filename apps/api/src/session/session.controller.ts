import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { IsString, MinLength } from 'class-validator';
import { SessionService } from './session.service';
import { AuditPmd, CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/decorators';
import { DenyTechPmdGuard } from '../common/roles.guard';

class ChatDto {
  @IsString()
  @MinLength(1)
  body!: string;
}

class FileDto {
  @IsString()
  fileName!: string;

  @IsString()
  contentType!: string;

  @IsString()
  @MinLength(8)
  base64!: string;
}

@Controller('sessions')
@UseGuards(DenyTechPmdGuard)
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  @Post('cases/:caseId/start')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.ORG_ADMIN,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.PATIENT,
  )
  start(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.sessions.startSession(user, caseId);
  }

  @Get('cases/:caseId/active')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.ORG_ADMIN,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.PATIENT,
    MembershipRole.AUDITOR,
  )
  active(@CurrentUser() user: AuthUser, @Param('caseId') caseId: string) {
    return this.sessions.getActiveForCase(user, caseId);
  }

  @Post(':id/join')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.ORG_ADMIN,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.PATIENT,
  )
  @AuditPmd({ objectType: 'session', action: 'join', idParam: 'id' })
  join(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sessions.joinSession(user, id);
  }

  @Post(':id/end')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.ORG_ADMIN,
    MembershipRole.DEPARTMENT_HEAD,
  )
  end(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sessions.endSession(user, id);
  }

  @Post(':id/leave')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.ORG_ADMIN,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.PATIENT,
  )
  leave(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sessions.leaveSession(user, id);
  }

  @Post(':id/chat')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.PATIENT,
    MembershipRole.ORG_ADMIN,
  )
  chat(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: ChatDto) {
    return this.sessions.postChat(user, id, body.body);
  }

  @Get(':id/chat')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.PATIENT,
    MembershipRole.ORG_ADMIN,
    MembershipRole.AUDITOR,
  )
  @AuditPmd({ objectType: 'session_chat', action: 'list', idParam: 'id' })
  listChat(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sessions.listChat(user, id);
  }

  @Post(':id/files')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.PATIENT,
  )
  upload(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: FileDto) {
    return this.sessions.uploadFile(user, id, body);
  }

  @Get(':id/recording')
  @Roles(
    MembershipRole.CONSULTANT,
    MembershipRole.AMBULATORY_WORKER,
    MembershipRole.DEPARTMENT_HEAD,
    MembershipRole.ORG_ADMIN,
    MembershipRole.AUDITOR,
  )
  @AuditPmd({ objectType: 'session_recording', action: 'download', idParam: 'id' })
  recording(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sessions.getRecordingUrl(user, id);
  }
}
