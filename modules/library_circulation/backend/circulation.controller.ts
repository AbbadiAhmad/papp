import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { BorrowDto } from './dto/borrow.dto';
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
    const { borrowing, daysLate } = await this.circulation.returnBorrowing(dto.borrowingId, user.userId);

    let lateFine = null;
    if (daysLate > 0) {
      const policy = await this.circulation.getLoanPolicy();
      const amount = daysLate * policy.finePerDay;
      if (amount > 0) {
        lateFine = await this.fines.createLateFine(borrowingBefore.studentId, dto.borrowingId, amount, user.userId);
      }
    }

    return { borrowing, daysLate, lateFine };
  }
}
