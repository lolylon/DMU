import { Module } from '@nestjs/common';
import { DossierService } from './dossier.service';
import { DossierController } from './dossier.controller';
import { StorageModule } from '../storage/storage.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [StorageModule, AuditModule],
  providers: [DossierService],
  controllers: [DossierController],
  exports: [DossierService],
})
export class DossierModule {}
