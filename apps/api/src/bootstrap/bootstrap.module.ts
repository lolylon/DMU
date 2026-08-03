import { Module } from '@nestjs/common';
import { BootstrapController } from './bootstrap.controller';
import { IdentityModule } from '../identity/identity.module';
import { ConsentModule } from '../consent/consent.module';

@Module({
  imports: [IdentityModule, ConsentModule],
  controllers: [BootstrapController],
})
export class BootstrapModule {}
