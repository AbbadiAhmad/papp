import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { CreateFineDto } from './dto/create-fine.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
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
  async findById(@Param('id') id: string) {
    return this.fines.findById(id);
  }

  @Post('fines')
  @RequirePermission('library_circulation.fines.record')
  @Audit({ category: 'library_circulation.fines', entityType: 'LibraryFine', action: 'create' })
  async create(@Body() dto: CreateFineDto, @CurrentUser() user: AuthenticatedUser) {
    return this.fines.create(dto, user.userId);
  }

  @Post('fines/:id/waive')
  @RequirePermission('library_circulation.fines.waive')
  @Audit({ category: 'library_circulation.fines', entityType: 'LibraryFine', action: 'update', fetchState: fetchFineState })
  async waive(@Param('id') id: string) {
    return this.fines.waive(id);
  }

  @Post('fines/:id/payments')
  @RequirePermission('library_circulation.finance.record_payment')
  @Audit({ category: 'library_circulation.finance', entityType: 'LibraryPayment', action: 'create' })
  async recordPayment(@Param('id') id: string, @Body() dto: RecordPaymentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.fines.recordPayment(id, dto.amount, user.userId);
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
