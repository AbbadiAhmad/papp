import { Controller, Get, HttpException, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import { BackupInfo, BackupNotConfiguredError, BackupService } from './backup.service';

/**
 * Whole-database backup export (docs/DECISIONS.md D43 resolution). Both
 * endpoints share `backup.export` — there is no separate "view" grant worth
 * its own code here.
 *
 * Restore is intentionally NOT exposed here, at all — see
 * `apps/api/src/cli-db.ts`. A real restore runs `pg_restore --clean`, which
 * needs an exclusive lock that queues behind (and queues other requests
 * behind) any connection the app's own Prisma pool holds. In the reference
 * implementation this was ported from, attempting restore through the HTTP
 * API made the whole app — including login — hang and time out. Restore is
 * `node dist/cli-db.js restore <file>`, run outside this process entirely
 * (see `scripts/manageDB.sh`).
 *
 * Phase 5 global-guard switch: `JwtAuthGuard`/`PermissionGuard` are global
 * (app.module.ts) — only `MustChangePasswordGuard` stays controller-scoped.
 */
@Controller('backup')
@UseGuards(MustChangePasswordGuard)
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Get('info')
  @RequirePermission('backup.export')
  async info(): Promise<BackupInfo> {
    return this.backupService.getInfo();
  }

  @Post('export')
  @RequirePermission('backup.export')
  @Audit({ category: 'core.backup', entityType: 'Database', action: 'export' })
  async export(@CurrentUser() user: AuthenticatedUser, @Res() res: Response): Promise<void> {
    let archive: Buffer;
    try {
      archive = await this.backupService.exportBackup(user.userId);
    } catch (error) {
      if (error instanceof BackupNotConfiguredError) {
        throw new HttpException('db_backup_not_configured', HttpStatus.CONFLICT);
      }
      throw error;
    }

    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="papp-backup-${timestamp}.zip"`,
    });
    res.send(archive);
  }

  /**
   * The uploaded files (book covers/files, survey pictures...), as a separate archive from the database
   * export — see backup-files.ts. Streamed straight to the response. Restore: `scripts/manageDB.sh restore-files`.
   */
  @Post('export-files')
  @RequirePermission('backup.export')
  @Audit({ category: 'core.backup', entityType: 'Files', action: 'export_files' })
  async exportFiles(@CurrentUser() user: AuthenticatedUser, @Res() res: Response): Promise<void> {
    if (!this.backupService.isConfigured()) {
      throw new HttpException('db_backup_not_configured', HttpStatus.CONFLICT);
    }
    if (this.backupService.fileRoots().length === 0) {
      throw new HttpException('backup_no_file_dirs', HttpStatus.CONFLICT);
    }
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="papp-files-${timestamp}.zip"`,
    });
    await this.backupService.exportFiles(user.userId, res);
  }
}
