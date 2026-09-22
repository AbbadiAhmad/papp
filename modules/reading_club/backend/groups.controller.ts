import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { CreateGroupDto } from './dto/create-group.dto';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { UpdateStageDto } from './dto/update-stage.dto';
import { GroupsService } from './groups.service';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';

const fetchGroupState = (prisma: PrismaClient, req: Request) =>
  prisma.readingClubGroup.findUnique({ where: { id: req.params.id as string } });
const fetchStageState = (prisma: PrismaClient, req: Request) =>
  prisma.readingClubStage.findUnique({ where: { id: req.params.stageId as string } });

/**
 * Groups + their ordered stages — "the librarian defines the groups, the
 * stages, the amount in every stage, the present after every stage, the
 * stage order" (see this module's own DOCUMENTATION.md "Settings" section
 * for why this is plain entity CRUD, not the manifest's `settings[]`
 * mechanism). `JwtAuthGuard`/`PermissionGuard` are global; only
 * `MustChangePasswordGuard` needs applying locally.
 */
@Controller('api/reading-club/groups')
@UseGuards(MustChangePasswordGuard)
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  @RequirePermission('reading_club.groups.view')
  async list(@Query('episodeId') episodeId?: string) {
    return this.groups.listGroups(episodeId);
  }

  @Get(':id')
  @RequirePermission('reading_club.groups.view')
  async findById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.groups.getGroup(id);
  }

  @Post()
  @RequirePermission('reading_club.groups.create')
  @Audit({ category: 'reading_club.groups', entityType: 'ReadingClubGroup', action: 'create' })
  async create(@Body() dto: CreateGroupDto, @CurrentUser() user: AuthenticatedUser) {
    return this.groups.createGroup(dto, user.userId);
  }

  @Patch(':id')
  @RequirePermission('reading_club.groups.update')
  @Audit({ category: 'reading_club.groups', entityType: 'ReadingClubGroup', action: 'update', fetchState: fetchGroupState })
  async update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateGroupDto) {
    return this.groups.updateGroup(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('reading_club.groups.delete')
  @Audit({ category: 'reading_club.groups', entityType: 'ReadingClubGroup', action: 'delete', fetchState: fetchGroupState })
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.groups.removeGroup(id);
  }

  // --- Stages (nested under their group) ---------------------------------

  @Get(':groupId/stages')
  @RequirePermission('reading_club.groups.view')
  async listStages(@Param('groupId', new ParseUUIDPipe()) groupId: string) {
    return this.groups.listStages(groupId);
  }

  @Post(':groupId/stages')
  @RequirePermission('reading_club.groups.update')
  @Audit({ category: 'reading_club.groups', entityType: 'ReadingClubStage', action: 'create' })
  async createStage(@Param('groupId', new ParseUUIDPipe()) groupId: string, @Body() dto: CreateStageDto) {
    return this.groups.createStage(groupId, dto);
  }

  @Patch('stages/:stageId')
  @RequirePermission('reading_club.groups.update')
  @Audit({ category: 'reading_club.groups', entityType: 'ReadingClubStage', action: 'update', fetchState: fetchStageState })
  async updateStage(@Param('stageId', new ParseUUIDPipe()) stageId: string, @Body() dto: UpdateStageDto) {
    return this.groups.updateStage(stageId, dto);
  }

  @Delete('stages/:stageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('reading_club.groups.delete')
  @Audit({ category: 'reading_club.groups', entityType: 'ReadingClubStage', action: 'delete', fetchState: fetchStageState })
  async removeStage(@Param('stageId', new ParseUUIDPipe()) stageId: string): Promise<void> {
    await this.groups.removeStage(stageId);
  }
}
