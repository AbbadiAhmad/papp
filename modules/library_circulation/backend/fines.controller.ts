import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { CreateFineDto } from './dto/create-fine.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { UpdateFineDto } from './dto/update-fine.dto';
import { FinesService } from './fines.service';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';

const fetchFineState = (prisma: PrismaClient, req: Request) =>
  prisma.libraryFine.findUnique({ where: { id: req.params.id as string } });

@Controller('api/library-circulation')
@UseGuards(MustChangePasswordGuard)
export class FinesController {
  constructor(private readonly fines: FinesService) {}

  @Get('fine-types')
  @RequirePermission('library_circulation.fines.view')
  async listFineTypes() {
    return this.fines.listFineTypes();
  }

  @Get('fines')
  @RequirePermission('library_circulation.fines.view')
  async list(@Query('studentId') studentId?: string, @Query('status') status?: string) {
    return this.fines.list({ studentId, status });
  }

  @Get('fines/:id')
  @RequirePermission('library_circulation.fines.view')
  async findById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.fines.findById(id);
  }

  @Post('fines')
  @RequirePermission('library_circulation.fines.record')
  @Audit({ category: 'library_circulation.fines', entityType: 'LibraryFine', action: 'create' })
  async create(@Body() dto: CreateFineDto, @CurrentUser() user: AuthenticatedUser) {
    return this.fines.create(dto, user.userId);
  }

  /** Editable while unpaid/partially_paid — same permission that creates a fine (§ AskUserQuestion: pre-payment edit gate). */
  @Patch('fines/:id')
  @RequirePermission('library_circulation.fines.record')
  @Audit({ category: 'library_circulation.fines', entityType: 'LibraryFine', action: 'update', fetchState: fetchFineState })
  async update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateFineDto) {
    return this.fines.update(id, dto, false);
  }

  /** Editing a fine that's already fully paid — a distinct, more privileged permission than the pre-payment edit above. */
  @Patch('fines/:id/after-payment')
  @RequirePermission('library_circulation.fines.update_after_payment')
  @Audit({ category: 'library_circulation.fines', entityType: 'LibraryFine', action: 'update', fetchState: fetchFineState })
  async updateAfterPayment(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateFineDto) {
    return this.fines.update(id, dto, true);
  }

  @Post('fines/:id/waive')
  @RequirePermission('library_circulation.fines.waive')
  @Audit({ category: 'library_circulation.fines', entityType: 'LibraryFine', action: 'update', fetchState: fetchFineState })
  async waive(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.fines.waive(id);
  }

  @Post('fines/:id/payments')
  @RequirePermission('library_circulation.finance.record_payment')
  @Audit({ category: 'library_circulation.finance', entityType: 'LibraryPayment', action: 'create' })
  async recordPayment(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: RecordPaymentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.fines.recordPayment(id, dto.amount, user.userId, dto.paymentMethod);
  }

  @Get('finance/transactions')
  @RequirePermission('library_circulation.finance.view')
  async listTransactions() {
    return this.fines.listTransactions();
  }

  @Get('finance/payments')
  @RequirePermission('library_circulation.finance.view')
  async listPayments() {
    return this.fines.listPayments();
  }
}
