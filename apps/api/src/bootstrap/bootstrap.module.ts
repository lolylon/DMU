import { Module } from '@nestjs/common';
import { BootstrapController } from './bootstrap.controller';
import { IdentityModule } from '../identity/identity.module';
import { ConsentModule } from '../consent/consent.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FrontdeskModule } from '../frontdesk/frontdesk.module';
import { SchedulingModule } from '../scheduling/scheduling.module';

@Module({
  imports: [IdentityModule, ConsentModule, NotificationsModule, FrontdeskModule, SchedulingModule],
  controllers: [BootstrapController],
})
export class BootstrapModule {}
