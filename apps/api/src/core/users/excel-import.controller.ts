import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
// Side-effect import: pulls in @types/multer's `declare global { namespace
// Express { namespace Multer {...} } }` augmentation so `Express.Multer.File`
// resolves below — without this, nothing in this file otherwise references
// the `multer` module and TS may not load its ambient types.
import 'multer';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import { ExcelImportService } from './excel-import.service';
import { ImportReport } from './excel-import.types';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * D42: preview validates without writing; commit re-validates from scratch
 * (it re-parses the SAME uploaded file rather than accepting a client-held
 * preview result as ground truth — see ExcelImportService's docblock) and
 * commits all-or-nothing in a single transaction.
 *
 * Phase 5 global-guard switch: `JwtAuthGuard`/`PermissionGuard` are now
 * global (app.module.ts) — only `MustChangePasswordGuard` stays
 * controller-scoped.
 */
@Controller('users')
@UseGuards(MustChangePasswordGuard)
export class ExcelImportController {
  constructor(private readonly excelImportService: ExcelImportService) {}

  @Post('import/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('users.import')
  @UseInterceptors(FileInterceptor('file'))
  async preview(@UploadedFile() file?: Express.Multer.File): Promise<ImportReport> {
    if (!file) {
      throw new BadRequestException('No file uploaded (expected multipart field "file")');
    }
    const rows = await this.excelImportService.parseWorkbook(file.buffer);
    return this.excelImportService.validateRows(rows);
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('users.import')
  // Bulk action: one audit row for the whole commit, new_value = the full
  // ImportReport (per-row actions + matched user ids). Preview is not
  // audited — D42 guarantees it writes nothing. entity_id stays null (many
  // entities touched at once).
  @Audit({ category: 'core.users', entityType: 'User', action: 'import' })
  @UseInterceptors(FileInterceptor('file'))
  async commit(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ImportReport> {
    if (!file) {
      throw new BadRequestException('No file uploaded (expected multipart field "file")');
    }
    return this.excelImportService.commit(file.buffer, user.userId);
  }

  @Get('export')
  @RequirePermission('users.export')
  async export(@Res() res: Response): Promise<void> {
    const buffer = await this.excelImportService.exportUsers();
    res.set({
      'Content-Type': XLSX_CONTENT_TYPE,
      'Content-Disposition': 'attachment; filename="users-export.xlsx"',
    });
    res.send(buffer);
  }
}
