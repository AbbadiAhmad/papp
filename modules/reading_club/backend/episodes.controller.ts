import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { CreateEpisodeDto } from './dto/create-episode.dto';
import { EpisodesService } from './episodes.service';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';

const fetchEpisodeState = (prisma: PrismaClient, req: Request) =>
  prisma.readingClubEpisode.findUnique({ where: { id: req.params.id as string } });

/**
 * Episodes (seasons/years). Read access reuses `reading_club.groups.view`
 * (READING_CLUB-D12 — everyone who can browse groups needs to know which
 * episode they belong to and be able to switch to a past one); the write
 * endpoint (`POST /episodes`) is gated by the stronger, dedicated
 * `reading_club.episodes.manage`.
 */
@Controller('api/reading-club/episodes')
@UseGuards(MustChangePasswordGuard)
export class EpisodesController {
  constructor(private readonly episodes: EpisodesService) {}

  @Get()
  @RequirePermission('reading_club.groups.view')
  async list() {
    return this.episodes.listEpisodes();
  }

  @Get('current')
  @RequirePermission('reading_club.groups.view')
  async current() {
    return this.episodes.getCurrentEpisode();
  }

  @Get(':id')
  @RequirePermission('reading_club.groups.view')
  async findById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.episodes.getEpisodeOrThrow(id);
  }

  @Post()
  @RequirePermission('reading_club.episodes.manage')
  @Audit({ category: 'reading_club.episodes', entityType: 'ReadingClubEpisode', action: 'create' })
  async create(@Body() dto: CreateEpisodeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.episodes.createEpisode(dto, user.userId);
  }

  /**
   * Real cascade-blast-radius counts (groups/readers/completions/book
   * entries) for the frontend's type-to-confirm delete dialog to show
   * BEFORE the librarian types the episode's name (READING_CLUB-D17) — same
   * permission as the delete itself, since seeing this preview only matters
   * to someone who could actually delete.
   */
  @Get(':id/delete-preview')
  @RequirePermission('reading_club.episodes.manage')
  async deletePreview(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.episodes.getDeletePreview(id);
  }

  /**
   * Full cascade delete (READING_CLUB-D17) — any episode, including the
   * current one. Unlike group/stage deletion (READING_CLUB-D16), there is no
   * history-preservation angle: deleting the episode removes its own
   * groups/stages and every membership/completion/book-entry scoped to it,
   * full stop.
   */
  @Delete(':id')
  @RequirePermission('reading_club.episodes.manage')
  @Audit({ category: 'reading_club.episodes', entityType: 'ReadingClubEpisode', action: 'delete', fetchState: fetchEpisodeState })
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.episodes.deleteEpisode(id);
  }
}
