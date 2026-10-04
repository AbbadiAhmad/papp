import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { BorrowDto } from './dto/borrow.dto';
import { ExtendLoanDto } from './dto/extend-loan.dto';
import { ListBorrowingsDto } from './dto/list-borrowings.dto';
import { ReturnDto } from './dto/return.dto';
import { ScanDto } from './dto/scan.dto';
import { CirculationService } from './circulation.service';
import { FinesService } from './fines.service';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';

const fetchBorrowingState = (prisma: PrismaClient, req: Request) =>
  prisma.libraryBorrowing.findUnique({ where: { id: (req.body as { borrowingId?: string })?.borrowingId ?? '' } });

/**
 * The daily-use screens (§6/§7/§9/§30): scan, borrow, return. A late return
 * auto-creates a fine in the SAME request (§9: "auto-creates a fine if
 * policy requires") — `FinesService` is injected directly rather than the
 * controller making a second HTTP round-trip to itself.
 */
@Controller('api/library-circulation')
@UseGuards(MustChangePasswordGuard)
export class CirculationController {
  constructor(
    private readonly circulation: CirculationService,
    private readonly fines: FinesService,
  ) {}

  @Post('scan')
  @RequirePermission('library_circulation.borrow')
  async scan(@Body() dto: ScanDto) {
    return this.circulation.scan(dto.code);
  }

  @Get('book-copies/:copyId/active-borrowing')
  @RequirePermission('library_circulation.return')
  async activeBorrowingForCopy(@Param('copyId') copyId: string) {
    return this.circulation.findActiveBorrowingForCopy(copyId);
  }

  /** Borrowings status page's filter bar — see CirculationService.listBorrowings's own docblock. */
  @Get('borrowings')
  @RequirePermission('library_circulation.borrowings.view')
  async listBorrowings(@Query() filter: ListBorrowingsDto) {
    return this.circulation.listBorrowings({
      studentId: filter.studentId,
      bookSearch: filter.bookSearch,
      status: filter.status,
      overdueOnly: filter.overdueOnly === 'true',
      borrowedFrom: filter.borrowedFrom,
      borrowedTo: filter.borrowedTo,
    });
  }

  /** Scan page's reader-centric view — this reader's active borrowings, enriched with book title/due date. */
  @Get('students/:studentId/active-borrowings')
  @RequirePermission('library_circulation.borrow')
  async activeBorrowingsForStudent(@Param('studentId') studentId: string) {
    return this.circulation.getActiveBorrowingsForStudent(studentId);
  }

  @Get('copies/:copyId/circulation-history')
  @RequirePermission('library_circulation.borrow')
  async getCopyCirculationHistory(@Param('copyId') copyId: string, @Query('limit') limit?: string) {
    const limitNumber = limit ? Math.min(parseInt(limit, 10), 100) : 10;
    return this.circulation.getCirculationHistory(copyId, undefined, limitNumber);
  }

  /** §2.1 (docs/LIBRARY_IMPROVEMENTS.md) — every reader who ever borrowed any copy of this book. */
  @Get('books/:bookId/circulation-history')
  @RequirePermission('library_circulation.borrow')
  async getBookCirculationHistory(@Param('bookId') bookId: string, @Query('limit') limit?: string) {
    const limitNumber = limit ? Math.min(parseInt(limit, 10), 100) : 10;
    return this.circulation.getBookCirculationHistory(bookId, limitNumber);
  }

  @Post('borrow')
  @RequirePermission('library_circulation.borrow')
  @Audit({ category: 'library_circulation.borrowings', entityType: 'LibraryBorrowing', action: 'create' })
  async borrow(@Body() dto: BorrowDto, @CurrentUser() user: AuthenticatedUser) {
    const expectedReturnDate = dto.expectedReturnDate ? new Date(dto.expectedReturnDate) : undefined;
    return this.circulation.borrow(dto.studentId, dto.bookCopyId, user.userId, expectedReturnDate, dto.comments);
  }

  @Post('return')
  @RequirePermission('library_circulation.return')
  @Audit({ category: 'library_circulation.borrowings', entityType: 'LibraryBorrowing', action: 'update', fetchState: fetchBorrowingState })
  async returnBorrowing(@Body() dto: ReturnDto, @CurrentUser() user: AuthenticatedUser) {
    const borrowingBefore = await this.circulation.findBorrowing(dto.borrowingId);
    const returnedAtOverride = dto.returnedAt ? new Date(dto.returnedAt) : undefined;
    const { borrowing, daysLate } = await this.circulation.returnBorrowing(
      dto.borrowingId,
      user.userId,
      dto.returnStatus,
      dto.returnNotes,
      returnedAtOverride,
    );

    let lateFine = null;
    // Auto-create fines for late returns — skipped when the librarian already added an inline fine covering this same return (dto.fine below), to avoid double-charging.
    if (daysLate > 0 && !dto.fine) {
      const policy = await this.circulation.getLoanPolicy();
      const amount = daysLate * policy.finePerDay;
      if (amount > 0) {
        lateFine = await this.fines.createLateFine(borrowingBefore.studentId, dto.borrowingId, amount, user.userId);
      }
    }

    // The librarian's own explicit fine, entered inline in the return dialog (checkbox + amount/type), created in this same request.
    let recordedFine = null;
    if (dto.fine) {
      recordedFine = await this.fines.create(
        { studentId: borrowingBefore.studentId, borrowingId: dto.borrowingId, fineTypeId: dto.fine.fineTypeId, amount: dto.fine.amount, notes: dto.fine.notes },
        user.userId,
      );
    }

    // Auto-suggest fine for damage/loss (caller decides whether to create it) — only still relevant if the librarian didn't already add one inline above.
    let damageFine = null;
    if ((dto.returnStatus === 'damaged' || dto.returnStatus === 'lost') && !dto.fine) {
      damageFine = { suggested: true, reason: dto.returnStatus };
    }

    return { borrowing, daysLate, lateFine, recordedFine, damageFine };
  }

  @Post('extend')
  @RequirePermission('library_circulation.extend')
  @Audit({ category: 'library_circulation.borrowings', entityType: 'LibraryBorrowing', action: 'update', fetchState: fetchBorrowingState })
  async extendLoan(@Body() dto: ExtendLoanDto) {
    return this.circulation.extendLoan(dto.borrowingId, new Date(dto.newDueDate));
  }
}
