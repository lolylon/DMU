import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { IS_KIOSK_KEY, type KioskContext } from './kiosk.decorators';

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

@Injectable()
export class KioskGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const needsKiosk = this.reflector.getAllAndOverride<boolean>(IS_KIOSK_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!needsKiosk) return true;

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      kiosk?: KioskContext;
    }>();
    const raw =
      req.headers['x-kiosk-token'] ??
      (req.headers.authorization?.startsWith('Kiosk ')
        ? req.headers.authorization.slice('Kiosk '.length).trim()
        : undefined);
    if (!raw) {
      throw new UnauthorizedException('Kiosk token required');
    }

    const device = await this.prisma.kioskDevice.findUnique({
      where: { tokenHash: hashToken(raw) },
      include: {
        organization: { select: { emergencyKioskEnabled: true, status: true } },
      },
    });
    if (!device || !device.enabled) {
      throw new UnauthorizedException('Invalid or disabled kiosk');
    }

    await this.prisma.kioskDevice.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });

    req.kiosk = {
      id: device.id,
      organizationId: device.organizationId,
      label: device.label,
      deviceCode: device.deviceCode,
      appVersion: device.appVersion,
      otaChannel: device.otaChannel,
      emergencyEnabled: device.emergencyEnabled,
      orgEmergencyEnabled: device.organization.emergencyKioskEnabled,
    };
    return true;
  }
}
