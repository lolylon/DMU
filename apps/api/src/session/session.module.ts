import { Module } from '@nestjs/common';
import { SessionService } from './session.service';
import { SessionController } from './session.controller';
import { RecordingPipelineService } from './recording-pipeline.service';
import { StorageModule } from '../storage/storage.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [StorageModule, AuditModule, NotificationsModule],
  providers: [SessionService, RecordingPipelineService],
  controllers: [SessionController],
  exports: [SessionService],
})
export class SessionModule {}
