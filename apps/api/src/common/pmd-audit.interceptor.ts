import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, switchMap } from 'rxjs';
import { AuditService } from '../audit/audit.service';
import { AUDIT_PMD_KEY, AuditPmdMeta, AuthUser } from './decorators';

/**
 * Fail-closed PMD access journal (architecture §4.4, TZ 7.4).
 * Audit write runs before handler result is returned; failure aborts the request.
 */
@Injectable()
export class PmdAccessAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditPmdMeta | undefined>(AUDIT_PMD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<{
      user?: AuthUser;
      params: Record<string, string>;
      ip?: string;
      headers: Record<string, string | undefined>;
    }>();

    const objectId = req.params[meta.idParam ?? 'id'] ?? 'unknown';
    const role = req.user?.memberships[0]?.role;
    const organizationId = req.user?.memberships[0]?.organizationId;

    return from(
      this.audit.logAccess({
        userId: req.user?.id,
        role: role ? String(role) : undefined,
        organizationId,
        objectType: meta.objectType,
        objectId,
        action: meta.action,
        ip: req.ip ?? req.headers['x-forwarded-for'],
      }),
    ).pipe(switchMap(() => next.handle()));
  }
}
