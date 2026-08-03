import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: MembershipRole[]) => SetMetadata(ROLES_KEY, roles);

export const AUDIT_PMD_KEY = 'auditPmd';
export type AuditPmdMeta = { objectType: string; action: string; idParam?: string };
export const AuditPmd = (meta: AuditPmdMeta) => SetMetadata(AUDIT_PMD_KEY, meta);

export type AuthMembership = {
  organizationId: string;
  role: MembershipRole;
};

export type AuthUser = {
  id: string;
  email: string | null;
  displayName: string;
  totpEnabled: boolean;
  iinHash: string | null;
  memberships: AuthMembership[];
  sessionId: string;
};

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
  return req.user;
});
