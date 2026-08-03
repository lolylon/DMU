import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AdminPrismaService } from './admin-prisma.service';

@Global()
@Module({
  providers: [PrismaService, AdminPrismaService],
  exports: [PrismaService, AdminPrismaService],
})
export class PrismaModule {}
