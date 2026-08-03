import { Module } from '@nestjs/common';
import { MisService } from './mis.service';
import { MisController } from './mis.controller';
import {
  DamumedAdapter,
  ManualBridgeAdapter,
  MockMisAdapter,
  ZhetysuAdapter,
} from './mis.adapters';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [MisService, ManualBridgeAdapter, MockMisAdapter, ZhetysuAdapter, DamumedAdapter],
  controllers: [MisController],
  exports: [MisService],
})
export class MisModule {}
