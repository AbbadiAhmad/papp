import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CreateEpisodeDto } from './dto/create-episode.dto';
import { EpisodesService } from './episodes.service';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';

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
}
