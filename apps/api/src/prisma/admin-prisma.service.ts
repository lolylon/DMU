import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Separate connection for tech/admin module (architecture §4.3).
 * Prefer ADMIN_DATABASE_URL → role miru_admin (no grants on PMD tables).
 * Falls back to DATABASE_URL only for local single-role setups.
 */
@Injectable()
export class AdminPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const url = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
    super(url ? { datasources: { db: { url } } } : undefined);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
