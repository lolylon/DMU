import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export const IS_KIOSK_KEY = 'isKiosk';
export const KioskRoute = () => SetMetadata(IS_KIOSK_KEY, true);

export type KioskContext = {
  id: string;
  organizationId: string;
  label: string;
  deviceCode: string;
  appVersion: string;
  otaChannel: string;
  emergencyEnabled: boolean;
  orgEmergencyEnabled: boolean;
};

export const CurrentKiosk = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): KioskContext => {
    const req = ctx.switchToHttp().getRequest<{ kiosk: KioskContext }>();
    return req.kiosk;
  },
);
