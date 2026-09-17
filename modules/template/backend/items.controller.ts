import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemsService } from './items.service';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';

const fetchItemState = (prisma: PrismaClient, req: Request) => prisma.templateItem.findUnique({ where: { id: req.params.id as string } });

/**
 * The permission-gated CRUD surface (docs/FEATURE_TEMPLATE.md §1's worked
 * example, applied here) — `JwtAuthGuard`/`PermissionGuard` are GLOBAL
 * (apps/api/src/app.module.ts) and already cover every controller,
 * including a dynamically-mounted module's; only `MustChangePasswordGuard`
 * needs applying locally.
 */
@Controller('api/template/items')
@UseGuards(MustChangePasswordGuard)
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @RequirePermission('template.items.view')
  async list() {
    return this.items.list();
  }

  @Get(':id')
  @RequirePermission('template.items.view')
  async findById(@Param('id') id: string) {
    return this.items.findById(id);
  }

  @Post()
  @RequirePermission('template.items.create')
  @Audit({ category: 'template.items', entityType: 'TemplateItem', action: 'create' })
  async create(@Body() dto: CreateItemDto, @CurrentUser() user: AuthenticatedUser) {
    return this.items.create(dto, user.userId);
  }

  @Patch(':id')
  @RequirePermission('template.items.update')
  @Audit({ category: 'template.items', entityType: 'TemplateItem', action: 'update', fetchState: fetchItemState })
  async update(@Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.items.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('template.items.delete')
  @Audit({ category: 'template.items', entityType: 'TemplateItem', action: 'delete', fetchState: fetchItemState })
  async remove(@Param('id') id: string): Promise<void> {
    await this.items.remove(id);
  }
}
