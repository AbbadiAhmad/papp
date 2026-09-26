import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { AddBookEntryDto } from './dto/add-book-entry.dto';
import { DiscardBookEntryDto } from './dto/discard-book-entry.dto';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';
import { StageBookEntriesService } from './stage-book-entries.service';

const fetchEntryState = (prisma: PrismaClient, req: Request) =>
  prisma.readingClubStageBookEntry.findUnique({ where: { id: req.params.entryId as string } });

/**
 * Per-stage book tracking (item D) — "books read this stage" list on a
 * reader's detail page. Gated by `reading_club.memberships.update_progress`
 * (READING_CLUB-D14: closest existing permission — "editing a reader's
 * stage-tracking data" — reused rather than inventing a new one) for every
 * mutating action; listing reuses the broader `.memberships.view` like the
 * rest of a reader's detail page.
 */
@Controller('api/reading-club/readers/:studentId/book-entries')
@UseGuards(MustChangePasswordGuard)
export class StageBookEntriesController {
  constructor(private readonly bookEntries: StageBookEntriesService) {}

  @Get()
  @RequirePermission('reading_club.memberships.view')
  async list(@Param('studentId', new ParseUUIDPipe()) studentId: string) {
    return this.bookEntries.listForReader(studentId);
  }

  @Post()
  @RequirePermission('reading_club.memberships.update_progress')
  @Audit({ category: 'reading_club.stage_book_entries', entityType: 'ReadingClubStageBookEntry', action: 'add_manual' })
  async addManual(
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Body() dto: AddBookEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookEntries.addManual(studentId, dto, user.userId);
  }

  @Patch(':entryId/discard')
  @RequirePermission('reading_club.memberships.update_progress')
  @Audit({
    category: 'reading_club.stage_book_entries',
    entityType: 'ReadingClubStageBookEntry',
    action: 'discard',
    fetchState: fetchEntryState,
  })
  async discard(
    @Param('studentId', new ParseUUIDPipe()) _studentId: string,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @Body() dto: DiscardBookEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookEntries.discard(entryId, dto, user.userId);
  }

  @Delete(':entryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('reading_club.memberships.update_progress')
  @Audit({
    category: 'reading_club.stage_book_entries',
    entityType: 'ReadingClubStageBookEntry',
    action: 'delete',
    fetchState: fetchEntryState,
  })
  async remove(
    @Param('studentId', new ParseUUIDPipe()) _studentId: string,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
  ): Promise<void> {
    await this.bookEntries.remove(entryId);
  }
}
