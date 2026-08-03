import { Module, forwardRef } from '@nestjs/common';
import { ConclusionService } from './conclusion.service';
import { ConclusionController, PatientConclusionController } from './conclusion.controller';
import { SigningModule } from '../signing/signing.module';
import { StorageModule } from '../storage/storage.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MisModule } from '../mis/mis.module';

@Module({
  imports: [
    SigningModule,
    StorageModule,
    AuditModule,
    NotificationsModule,
    forwardRef(() => MisModule),
  ],
  providers: [ConclusionService],
  controllers: [ConclusionController, PatientConclusionController],
  exports: [ConclusionService],
})
export class ConclusionModule {}
