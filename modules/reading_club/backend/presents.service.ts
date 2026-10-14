import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CLUB_EVENT_PUBLISHER, ClubEventPublisher } from './club-events';
import { EpisodesService } from './episodes.service';
import { GivePresentDto } from './dto/give-present.dto';

/**
 * A present the librarian gives a reader outside the stage-completion flow
 * (READING_CLUB-D25). Recorded as free text plus a JSON snapshot of the
 * episode/group/stage the reader was in at that moment, so it displays
 * correctly forever. Only allowed in the current episode.
 */
@Injectable()
export class PresentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresentsService.name);
  private readonly prisma = new PrismaClient();

  constructor(
    private readonly episodes: EpisodesService,
    @Optional() @Inject(CLUB_EVENT_PUBLISHER) private readonly events?: ClubEventPublisher,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('reading_club (presents) Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async give(studentId: string, dto: GivePresentDto, givenBy: string) {
    const student = await this.prisma.libraryStudent.findUnique({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Reader not found');

    const membership = await this.prisma.readingClubMembership.findUnique({ where: { studentId } });
    const episode = membership ? await this.episodes.getEpisodeOrThrow(membership.episodeId) : await this.episodes.getCurrentEpisode();
    await this.episodes.assertEpisodeIsCurrent(episode.id);

    const description = dto.description.trim();
    const present = await this.prisma.readingClubPresent.create({
      data: {
        studentId,
        episodeId: episode.id,
        description,
        context: { episodeName: episode.name, groupName: membership?.groupName ?? null, stageName: membership?.stageName ?? null },
        givenBy,
      },
    });
    await this.events?.publish({ type: 'reward_given', studentId, details: description });
    return present;
  }

  private async getEditablePresent(presentId: string) {
    const present = await this.prisma.readingClubPresent.findUnique({ where: { id: presentId } });
    if (!present) throw new NotFoundException('Present not found');
    await this.episodes.assertEpisodeIsCurrent(present.episodeId);
    return present;
  }

  /** Corrects the text of an additional present (READING_CLUB-D28). Only in the current episode. */
  async update(presentId: string, dto: GivePresentDto) {
    await this.getEditablePresent(presentId);
    return this.prisma.readingClubPresent.update({ where: { id: presentId }, data: { description: dto.description.trim() } });
  }

  /** Removes an additional present recorded by mistake (READING_CLUB-D28). Only in the current episode. */
  async remove(presentId: string): Promise<{ removed: true }> {
    await this.getEditablePresent(presentId);
    await this.prisma.readingClubPresent.delete({ where: { id: presentId } });
    return { removed: true };
  }
}
