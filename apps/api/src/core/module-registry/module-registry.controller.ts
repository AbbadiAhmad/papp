import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import type { PrismaService } from '../../prisma/prisma.service';
import { InstallModuleDto } from './dto/install-module.dto';
import { UninstallModuleDto } from './dto/uninstall-module.dto';
import { FrontendModuleManifest, PublicModuleEntry } from './module-registry.presenter';
import { ModuleRegistryService } from './module-registry.service';

const fetchModuleStateByBodyKey = (prisma: PrismaService, req: Request) =>
  prisma.moduleRegistryEntry.findUnique({ where: { key: (req.body as { key: string }).key } });

const fetchModuleStateByParamKey = (prisma: PrismaService, req: Request) =>
  prisma.moduleRegistryEntry.findUnique({ where: { key: req.params.key as string } });

/**
 * `JwtAuthGuard`/`PermissionGuard` are global (see app.module.ts) — only
 * `MustChangePasswordGuard` stays controller-scoped, same pattern as every
 * other core controller (see that guard's own docblock for why).
 *
 * `POST /modules/install` (and `/:key/upgrade`) trigger the D15 orchestrated
 * restart ONLY after the HTTP response has actually flushed
 * (`res.on('finish', ...)`) — `ModuleRegistryService.install()`/`upgrade()`
 * themselves never call `process.exit`, so they stay directly unit-testable.
 */
@Controller('modules')
@UseGuards(MustChangePasswordGuard)
export class ModuleRegistryController {
  constructor(private readonly moduleRegistry: ModuleRegistryService) {}

  @Get()
  @RequirePermission('modules.view')
  async list(): Promise<PublicModuleEntry[]> {
    return this.moduleRegistry.list();
  }

  /**
   * `@Public()`, no `@RequirePermission` — same category as `GET /i18n/:lang`
   * (i18n.controller.ts's own docblock): a structural read with no
   * per-caller side effect and nothing sensitive in the payload (route
   * patterns/menu labels, not manifest internals — see
   * `FrontendModuleManifest`'s own docblock), needed by the anonymous route
   * tree itself before any session exists. This is the ONE thing that lets
   * `apps/web/src/App.tsx`/`PageLayout.tsx` mount a module's routes/menu
   * without importing that module by name (root DECISIONS.md D78) — every
   * caller, logged in or not, hits this same endpoint.
   */
  @Get('frontend-manifest')
  @Public()
  async frontendManifest(): Promise<FrontendModuleManifest[]> {
    return this.moduleRegistry.listFrontendManifests();
  }

  @Post('install')
  @RequirePermission('modules.install')
  @Audit({
    category: 'core.modules',
    entityType: 'ModuleRegistryEntry',
    action: 'install',
    fetchState: fetchModuleStateByBodyKey,
  })
  async install(
    @Body() dto: InstallModuleDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicModuleEntry> {
    const result = await this.moduleRegistry.install(dto.key, user.userId);
    res.on('finish', () => this.moduleRegistry.triggerOrchestratedRestart(dto.key, 'install'));
    return result;
  }

  @Post(':key/upgrade')
  @RequirePermission('modules.upgrade')
  @Audit({
    category: 'core.modules',
    entityType: 'ModuleRegistryEntry',
    action: 'upgrade',
    entityIdParam: 'key',
    fetchState: fetchModuleStateByParamKey,
  })
  async upgrade(
    @Param('key') key: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicModuleEntry> {
    const result = await this.moduleRegistry.upgrade(key, user.userId);
    res.on('finish', () => this.moduleRegistry.triggerOrchestratedRestart(key, 'upgrade'));
    return result;
  }

  @Post(':key/uninstall')
  @RequirePermission('modules.uninstall')
  @Audit({
    category: 'core.modules',
    entityType: 'ModuleRegistryEntry',
    action: 'uninstall',
    entityIdParam: 'key',
    fetchState: fetchModuleStateByParamKey,
  })
  async uninstall(@Param('key') key: string, @Body() dto: UninstallModuleDto): Promise<PublicModuleEntry> {
    // Uninstall does NOT trigger the orchestrated restart (MODULE_SPEC.md §5:
    // de-registration is immediate at the registry/permission/menu level;
    // nothing here needs the NestJS module graph itself to be rebuilt until
    // the next natural deploy — unlike install/upgrade, which must mount a
    // brand new NestJS module that doesn't exist in the running graph yet).
    return this.moduleRegistry.uninstall(key, dto.dropData ?? false);
  }
}
