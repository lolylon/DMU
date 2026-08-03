import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { ROLES_REQUIRING_2FA, validatePasswordPolicy } from '@miru/shared';
import { PrismaService } from '../prisma/prisma.service';
import { generateSessionToken, sha256 } from '../common/crypto';
import { AuthUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';

const SESSION_TTL_HOURS = 12;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  validatePasswordPolicy(password: string): string | null {
    return validatePasswordPolicy(password);
  }

  hashPassword(password: string) {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  verifyPassword(hash: string, password: string) {
    return argon2.verify(hash, password);
  }

  async createStaffUser(input: {
    email: string;
    password: string;
    displayName: string;
    organizationId: string;
    role: MembershipRole;
  }) {
    const policyError = this.validatePasswordPolicy(input.password);
    if (policyError) throw new BadRequestException(policyError);

    const passwordHash = await this.hashPassword(input.password);
    return this.prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        displayName: input.displayName,
        passwordHash,
        memberships: {
          create: {
            organizationId: input.organizationId,
            role: input.role,
          },
        },
      },
      include: { memberships: true },
    });
  }

  async login(input: {
    email: string;
    password: string;
    totpCode?: string;
    ip?: string;
    userAgent?: string;
  }) {
    const email = input.email.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: true },
    });

    // Do not reveal whether email exists (same message)
    const invalid = () => {
      throw new UnauthorizedException('Invalid credentials');
    };

    if (!user?.passwordHash) {
      invalid();
    }

    if (user!.isBlocked) {
      throw new ForbiddenException('Account is blocked');
    }

    if (user!.lockedUntil && user!.lockedUntil > new Date()) {
      throw new ForbiddenException('Account temporarily locked after failed logins');
    }

    const passwordOk = await this.verifyPassword(user!.passwordHash!, input.password);
    if (!passwordOk) {
      await this.registerFailedLogin(user!.id);
      await this.audit.logAccess({
        userId: user!.id,
        action: 'login_failed',
        objectType: 'auth',
        objectId: user!.id,
        ip: input.ip,
      });
      invalid();
    }

    const needs2fa = user!.memberships.some((m) =>
      (ROLES_REQUIRING_2FA as readonly string[]).includes(m.role),
    );

    if (needs2fa) {
      if (!user!.totpEnabled || !user!.totpSecret) {
        throw new ForbiddenException('Two-factor authentication must be enrolled before login');
      }
      if (!input.totpCode) {
        throw new UnauthorizedException({
          message: 'TOTP code required',
          code: 'TOTP_REQUIRED',
        });
      }
      const totpOk = authenticator.check(input.totpCode, user!.totpSecret);
      if (!totpOk) {
        await this.registerFailedLogin(user!.id);
        throw new UnauthorizedException('Invalid TOTP code');
      }
    }

    await this.prisma.user.update({
      where: { id: user!.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });

    const session = await this.createSession(user!.id, input.ip, input.userAgent);
    await this.audit.logAccess({
      userId: user!.id,
      role: user!.memberships[0]?.role,
      organizationId: user!.memberships[0]?.organizationId,
      action: 'login_success',
      objectType: 'auth',
      objectId: user!.id,
      ip: input.ip,
    });

    return {
      accessToken: session.token,
      expiresAt: session.expiresAt,
      user: {
        id: user!.id,
        email: user!.email,
        displayName: user!.displayName,
        totpEnabled: user!.totpEnabled,
        memberships: user!.memberships.map((m) => ({
          organizationId: m.organizationId,
          role: m.role,
        })),
      },
    };
  }

  async beginTotpEnrollment(userId: string) {
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret, totpEnabled: false },
    });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const otpauth = authenticator.keyuri(user.email ?? user.id, 'Miru Remote', secret);
    return { secret, otpauth };
  }

  async confirmTotpEnrollment(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpSecret) throw new BadRequestException('TOTP enrollment not started');
    if (!authenticator.check(code, user.totpSecret)) {
      throw new UnauthorizedException('Invalid TOTP code');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: true },
    });
    return { totpEnabled: true };
  }

  async logout(sessionId: string, userId: string) {
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllSessions(userId: string) {
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async resolveSession(token: string): Promise<AuthUser | null> {
    const tokenHash = sha256(token);
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash },
      include: {
        user: { include: { memberships: true } },
      },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
    if (session.user.isBlocked) return null;

    return {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      totpEnabled: session.user.totpEnabled,
      iinHash: session.user.iinHash,
      sessionId: session.id,
      memberships: session.user.memberships.map((m) => ({
        organizationId: m.organizationId,
        role: m.role,
      })),
    };
  }

  /** Used by patient Mini App auth after IIN+code verification */
  async issueSession(userId: string, ip?: string, userAgent?: string) {
    return this.createSession(userId, ip, userAgent);
  }

  private async createSession(userId: string, ip?: string, userAgent?: string) {
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
    const row = await this.prisma.authSession.create({
      data: {
        userId,
        tokenHash: sha256(token),
        expiresAt,
        ip,
        userAgent,
      },
    });
    return { token, expiresAt, id: row.id };
  }

  private async registerFailedLogin(userId: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
    });
    if (user.failedLoginCount >= MAX_FAILED_LOGINS) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000),
          failedLoginCount: 0,
        },
      });
    }
  }
}
