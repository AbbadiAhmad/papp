import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { AssignMembershipDto } from './dto/assign-membership.dto';
import { MoveStageDto } from './dto/move-stage.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { MembershipsService } from './memberships.service';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';

const fetchMembershipState = (prisma: PrismaClient, req: Request) =>
  prisma.readingClubMembership.findUnique({ where: { studentId: req.params.studentId as string } });

@Controller('api/reading-club/readers')
@UseGuards(MustChangePasswordGuard)
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  @RequirePermission('reading_club.memberships.view')
  async list(
    @Query('groupId') groupId?: string,
    @Query('stageId') stageId?: string,
    @Query('search') search?: string,
    @Query('episodeId') episodeId?: string,
  ) {
    return this.memberships.listReaders({ episodeId, groupId, stageId, search });
  }

  @Get(':studentId')
  @RequirePermission('reading_club.memberships.view')
  async findById(@Param('studentId', new ParseUUIDPipe()) studentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.memberships.getReaderDetail(studentId, user.userId);
  }

  @Post('assign')
  @RequirePermission('reading_club.memberships.assign')
  @Audit({ category: 'reading_club.memberships', entityType: 'ReadingClubMembership', action: 'assign' })
  async assign(@Body() dto: AssignMembershipDto, @CurrentUser() user: AuthenticatedUser) {
    return this.memberships.assign(dto, user.userId);
  }

  @Post(':studentId/move-stage')
  @RequirePermission('reading_club.memberships.assign')
  @Audit({ category: 'reading_club.memberships', entityType: 'ReadingClubMembership', action: 'move_stage', fetchState: fetchMembershipState })
  async moveStage(@Param('studentId', new ParseUUIDPipe()) studentId: string, @Body() dto: MoveStageDto) {
    return this.memberships.moveStage(studentId, dto);
  }

  @Put(':studentId/progress')
  @RequirePermission('reading_club.memberships.update_progress')
  @Audit({ category: 'reading_club.memberships', entityType: 'ReadingClubMembership', action: 'update_progress', fetchState: fetchMembershipState })
  async updateProgress(@Param('studentId', new ParseUUIDPipe()) studentId: string, @Body() dto: UpdateProgressDto) {
    return this.memberships.updateManualProgress(studentId, dto);
  }
}
