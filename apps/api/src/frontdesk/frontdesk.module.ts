import { Module } from '@nestjs/common';
import { FrontdeskController } from './frontdesk.controller';
import { FrontdeskService } from './frontdesk.service';
import { KioskGuard } from './kiosk.guard';
import { PatientModule } from '../patient/patient.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PatientModule, SchedulingModule, AuditModule],
  controllers: [FrontdeskController],
  providers: [FrontdeskService, KioskGuard],
  exports: [FrontdeskService],
})
export class FrontdeskModule {}
