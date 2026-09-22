import { ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { CreateEpisodeDto } from './dto/create-episode.dto';

/**
 * Episodes (seasons/years) — the top-level scope everything else in this
 * module now lives under (groups/stages/memberships/completions/book
 * entries). One global "current" episode at a time (READING_CLUB-D10):
 * starting a new one closes whatever was previously current, in the same
 * transaction, so there is never a moment with zero or multiple current
 * episodes visible to a concurrent reader.
 *
 * Own dedicated `PrismaClient` (D57 pattern, same as every other service in
 * this module).
 */
@Injectable()
export class EpisodesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EpisodesService.name);
  private readonly prisma = new PrismaClient();

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('reading_club (episodes) Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async listEpisodes() {
    return this.prisma.readingClubEpisode.findMany({ orderBy: { startsAt: 'desc' } });
  }

  async getCurrentEpisode() {
    const current = await this.prisma.readingClubEpisode.findFirst({ where: { isCurrent: true } });
    if (!current) throw new NotFoundException('No current episode — create one first');
    return current;
  }

  /** Same lookup as `getCurrentEpisode` but returns `null` instead of throwing — for callers that want to default to "current" without failing hard when none exists yet. */
  async findCurrentEpisodeOrNull() {
    return this.prisma.readingClubEpisode.findFirst({ where: { isCurrent: true } });
  }

  async getEpisodeOrThrow(id: string) {
    const episode = await this.prisma.readingClubEpisode.findUnique({ where: { id } });
    if (!episode) throw new NotFoundException('Episode not found');
    return episode;
  }

  /** Rejects a mutation against a non-current episode (past episodes are read-only) — see READING_CLUB-D12. */
  async assertEpisodeIsCurrent(episodeId: string): Promise<void> {
    const episode = await this.getEpisodeOrThrow(episodeId);
    if (!episode.isCurrent) {
      throw new ConflictException('This episode is closed — only the current episode can be modified');
    }
  }

  /** Closes whatever episode is currently open (if any) and starts a new one, in one transaction. */
  async createEpisode(dto: CreateEpisodeDto, createdBy: string) {
    const previouslyCurrent = await this.prisma.readingClubEpisode.findFirst({ where: { isCurrent: true } });

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (previouslyCurrent) {
      ops.push(
        this.prisma.readingClubEpisode.update({
          where: { id: previouslyCurrent.id },
          data: { isCurrent: false, endsAt: new Date() },
        }),
      );
    }
    ops.push(
      this.prisma.readingClubEpisode.create({
        data: { name: dto.name, isCurrent: true, createdBy },
      }),
    );

    const results = await this.prisma.$transaction(ops);
    return results[results.length - 1];
  }
}
