import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './decorators';
import { IdentityService } from '../identity/identity.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identity: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      ip?: string;
      user?: unknown;
    }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication required');
    }
    const token = header.slice('Bearer '.length).trim();
    const user = await this.identity.resolveSession(token);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired session');
    }
    req.user = user;
    return true;
  }
}
