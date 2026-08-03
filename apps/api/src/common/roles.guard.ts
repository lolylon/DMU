import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipRole } from '@prisma/client';
import { AuthUser, ROLES_KEY } from './decorators';
import { TECH_ROLES_NO_PMD } from '@miru/shared';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<MembershipRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;

    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    if (!user) throw new ForbiddenException('No authenticated user');

    const userRoles = new Set(user.memberships.map((m) => m.role));
    const ok = roles.some((r) => userRoles.has(r));
    if (!ok) throw new ForbiddenException('Insufficient role');
    return true;
  }
}

/** Blocks tech/platform admin from PMD content endpoints (TZ 11.2) */
@Injectable()
export class DenyTechPmdGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    if (!user) throw new ForbiddenException('No authenticated user');

    const onlyTech = user.memberships.every((m) =>
      (TECH_ROLES_NO_PMD as readonly string[]).includes(m.role),
    );
    if (onlyTech && user.memberships.length > 0) {
      throw new ForbiddenException('Platform/tech roles cannot access PMD content');
    }
    return true;
  }
}
