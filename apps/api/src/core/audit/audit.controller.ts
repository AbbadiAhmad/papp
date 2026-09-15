import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { extractRequestMeta } from '../auth/request-meta.util';
import { AuditPage, AuditService, PurgeResult } from './audit.service';
import { PurgeAuditDto } from './dto/purge-audit.dto';
import { QueryAuditDto } from './dto/query-audit.dto';

/**
 * Read/purge surface for the audit log (ARCHITECTURE.md §8.4, D25).
 * Permission-gated by CODE like everything else (`audit.view` /
 * `audit.purge`, seeded by 0005 per D46) — never by role name.
 *
 * Neither endpoint carries @Audit: GET is a read, and the purge writes its
 * own richer row (with the real deleted-row count) from AuditService, AFTER
 * the delete completes.
 */
@Controller('audit')
@UseGuards(JwtAuthGuard, MustChangePasswordGuard, PermissionGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermission('audit.view')
  async query(@Query() dto: QueryAuditDto): Promise<AuditPage> {
    return this.auditService.query(dto);
  }

  @Post('purge')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('audit.purge')
  async purge(
    @Body() dto: PurgeAuditDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<PurgeResult> {
    const meta = extractRequestMeta(req);
    return this.auditService.purge(dto.cutoffDate, {
      userId: user.userId,
      sessionId: user.sessionId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }
}
