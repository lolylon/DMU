import { Module } from '@nestjs/common';
import { PatientService } from './patient.service';
import { PatientController } from './patient.controller';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [IdentityModule, NotificationsModule, SchedulingModule, AuditModule],
  providers: [PatientService],
  controllers: [PatientController],
  exports: [PatientService],
})
export class PatientModule {}
