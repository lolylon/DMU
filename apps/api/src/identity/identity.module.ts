import { Module, forwardRef } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { IdentityController } from './identity.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [forwardRef(() => AuditModule)],
  providers: [IdentityService],
  controllers: [IdentityController],
  exports: [IdentityService],
})
export class IdentityModule {}
