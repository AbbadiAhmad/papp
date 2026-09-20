import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { CreatePageDto } from './dto/create-page.dto';
import { ReplaceBlocksDto } from './dto/replace-blocks.dto';
import { UpdatePageDto } from './dto/update-page.dto';
import { Audit, MustChangePasswordGuard, RequirePermission } from './platform';
import { PagesService } from './pages.service';

const fetchPageState = (prisma: PrismaClient, req: Request) =>
  prisma.websitePage.findUnique({ where: { id: req.params.id as string } });

@Controller('api/website/pages')
@UseGuards(MustChangePasswordGuard)
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  @Get()
  @RequirePermission('website.pages.view')
  async list() {
    return this.pages.list();
  }

  @Get(':id')
  @RequirePermission('website.pages.view')
  async findById(@Param('id') id: string) {
    return this.pages.findById(id);
  }

  @Post()
  @RequirePermission('website.pages.create')
  @Audit({ category: 'website.pages', entityType: 'WebsitePage', action: 'create' })
  async create(@Body() dto: CreatePageDto) {
    return this.pages.create(dto);
  }

  @Patch(':id')
  @RequirePermission('website.pages.update')
  @Audit({ category: 'website.pages', entityType: 'WebsitePage', action: 'update', fetchState: fetchPageState })
  async update(@Param('id') id: string, @Body() dto: UpdatePageDto) {
    return this.pages.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('website.pages.delete')
  @Audit({ category: 'website.pages', entityType: 'WebsitePage', action: 'delete', fetchState: fetchPageState })
  async remove(@Param('id') id: string): Promise<void> {
    await this.pages.remove(id);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('website.pages.publish')
  @Audit({ category: 'website.pages', entityType: 'WebsitePage', action: 'update', fetchState: fetchPageState })
  async publish(@Param('id') id: string) {
    return this.pages.publish(id);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('website.pages.publish')
  @Audit({ category: 'website.pages', entityType: 'WebsitePage', action: 'update', fetchState: fetchPageState })
  async unpublish(@Param('id') id: string) {
    return this.pages.unpublish(id);
  }

  @Put(':id/blocks')
  @RequirePermission('website.pages.update')
  @Audit({ category: 'website.pages', entityType: 'WebsitePage', action: 'update', fetchState: fetchPageState })
  async replaceBlocks(@Param('id') id: string, @Body() dto: ReplaceBlocksDto) {
    return this.pages.replaceBlocks(id, dto.blocks);
  }
}
