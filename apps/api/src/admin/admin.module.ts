import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { IdentityModule } from '../identity/identity.module';
import { ConsentModule } from '../consent/consent.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [IdentityModule, ConsentModule, AuditModule],
  providers: [AdminService],
  controllers: [AdminController],
  exports: [AdminService],
})
export class AdminModule {}
