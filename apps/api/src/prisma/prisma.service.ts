import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Thin wrapper around the generated Prisma client — client wiring only
 * (connect on module init, disconnect on module destroy). No query logic
 * lives here; this is the standard NestJS-Prisma pattern.
 *
 * Note: this project never runs `prisma migrate` (see D16 in
 * docs/DECISIONS.md) — schema changes are raw `.sql` migration files applied
 * by MigrationRunnerService, with schema.prisma hand-updated to match.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma client disconnected');
  }
}
