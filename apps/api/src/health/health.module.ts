import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [SessionModule],
  controllers: [HealthController],
})
export class HealthModule {}
