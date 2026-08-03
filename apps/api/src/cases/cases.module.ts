import { Module } from '@nestjs/common';
import { CasesService } from './cases.service';
import { CasesController } from './cases.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [CasesService],
  controllers: [CasesController],
  exports: [CasesService],
})
export class CasesModule {}
