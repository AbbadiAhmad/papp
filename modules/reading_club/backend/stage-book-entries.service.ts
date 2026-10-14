import { ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AddBookEntryDto } from './dto/add-book-entry.dto';
import { DiscardBookEntryDto } from './dto/discard-book-entry.dto';
import { MembershipsService } from './memberships.service';

/**
 * Per-stage book tracking (item D): every entry — whether auto-synced from
 * a returned borrowing (`MembershipsService.syncStageBookEntries`, see that
 * file) or manually added here — can be listed, discarded (soft, stays
 * visible, excluded from counts) or deleted (hard, gone entirely). Both
 * actions apply equally to auto and manual entries. See DECISIONS.md
 * READING_CLUB-D13/D14 for the full reasoning.
 *
 * Own dedicated `PrismaClient` (D57 pattern).
 */
@Injectable()
export class StageBookEntriesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StageBookEntriesService.name);
  private readonly prisma = new PrismaClient();

  constructor(private readonly memberships: MembershipsService) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('reading_club (stage book entries) Prisma client connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  /** Active + discarded entries for the reader's CURRENT stage window (their current membership's group/stage). */
  async listForReader(studentId: string) {
    const membership = await this.memberships.getMembershipOrThrow(studentId);
    const entries = await this.prisma.readingClubStageBookEntry.findMany({
      where: { studentId, groupId: membership.groupId, stageId: membership.currentStageId! },
      orderBy: { addedAt: 'desc' },
    });
    return this.withCatalogInfo(entries);
  }

  /**
   * READING_CLUB-D29: adds the book's catalog `category` + `readingLevel` (read live — not snapshotted) for the
   * "confirm stage" popup. Manual entries with no linked copy, or a since-deleted book, get nulls.
   */
  private async withCatalogInfo<T extends { bookCopyId: string | null }>(entries: T[]): Promise<Array<T & { category: string | null; readingLevel: string | null }>> {
    const copyIds = [...new Set(entries.map((e) => e.bookCopyId).filter((id): id is string => !!id))];
    const copies = copyIds.length ? ((await this.prisma.libraryCatalogBookCopy.findMany({ where: { id: { in: copyIds } }, select: { id: true, bookId: true } })) ?? []) : [];
    const bookIds = [...new Set(copies.map((c) => c.bookId))];
    const books = bookIds.length ? ((await this.prisma.libraryCatalogBook.findMany({ where: { id: { in: bookIds } }, select: { id: true, category: true, readingLevel: true } })) ?? []) : [];
    const bookByCopy = new Map(copies.map((c) => [c.id, books.find((b) => b.id === c.bookId)]));
    return entries.map((e) => {
      const book = e.bookCopyId ? bookByCopy.get(e.bookCopyId) : undefined;
      return { ...e, category: book?.category ?? null, readingLevel: book?.readingLevel ?? null };
    });
  }

  /** `groupName`/`stageName` are snapshotted from the membership's own current snapshot at add time (READING_CLUB-D16) — consistent with the auto-sync half in MembershipsService.syncStageBookEntries. */
  async addManual(studentId: string, dto: AddBookEntryDto, addedBy: string) {
    const membership = await this.memberships.getMembershipOrThrow(studentId);
    return this.prisma.readingClubStageBookEntry.create({
      data: {
        studentId,
        episodeId: membership.episodeId,
        groupId: membership.groupId,
        groupName: membership.groupName,
        stageId: membership.currentStageId!,
        stageName: membership.stageName,
        bookCopyId: dto.bookCopyId ?? null,
        bookTitle: dto.bookTitle,
        bookCode: dto.bookCode ?? null,
        pageCount: dto.pageCount ?? null,
        comments: dto.comments ?? null,
        source: 'manual',
        addedBy,
      },
    });
  }

  /** Soft: sets status='discarded', keeps the row (struck-through/muted in the UI, excluded from any count). `reason` is optional. */
  async discard(entryId: string, dto: DiscardBookEntryDto, discardedBy: string) {
    const entry = await this.getEntryOrThrow(entryId);
    if (entry.status === 'discarded') {
      throw new ConflictException('This entry is already discarded');
    }
    return this.prisma.readingClubStageBookEntry.update({
      where: { id: entryId },
      data: { status: 'discarded', discardedAt: new Date(), discardedBy, discardReason: dto.reason ?? null },
    });
  }

  /** Hard delete — gone entirely, unlike `discard`. Available for both auto and manual entries. */
  async remove(entryId: string): Promise<void> {
    await this.getEntryOrThrow(entryId);
    await this.prisma.readingClubStageBookEntry.delete({ where: { id: entryId } });
  }

  private async getEntryOrThrow(id: string) {
    const entry = await this.prisma.readingClubStageBookEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Book entry not found');
    return entry;
  }
}
