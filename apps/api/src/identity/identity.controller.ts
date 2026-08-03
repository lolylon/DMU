import { Body, Controller, Headers, Ip, Post } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { IdentityService } from './identity.service';
import { CurrentUser, Public } from '../common/decorators';
import type { AuthUser } from '../common/decorators';

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsOptional()
  @IsString()
  totpCode?: string;
}

class TotpConfirmDto {
  @IsString()
  @MinLength(6)
  code!: string;
}

@Controller('auth')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Public()
  @Post('login')
  login(
    @Body() body: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.identity.login({
      email: body.email,
      password: body.password,
      totpCode: body.totpCode,
      ip,
      userAgent,
    });
  }

  @Post('logout')
  async logout(@CurrentUser() user: AuthUser) {
    await this.identity.logout(user.sessionId, user.id);
    return { ok: true };
  }

  @Post('2fa/begin')
  begin2fa(@CurrentUser() user: AuthUser) {
    return this.identity.beginTotpEnrollment(user.id);
  }

  @Post('2fa/confirm')
  confirm2fa(@CurrentUser() user: AuthUser, @Body() body: TotpConfirmDto) {
    return this.identity.confirmTotpEnrollment(user.id, body.code);
  }
}
