import { Module } from '@nestjs/common';
import { ConsentService } from './consent.service';
import { ConsentController } from './consent.controller';
import { CasesModule } from '../cases/cases.module';

@Module({
  imports: [CasesModule],
  providers: [ConsentService],
  controllers: [ConsentController],
  exports: [ConsentService],
})
export class ConsentModule {}
