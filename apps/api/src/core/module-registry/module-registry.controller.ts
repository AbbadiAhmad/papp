import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MustChangePasswordGuard } from '../../common/guards/must-change-password.guard';
import type { PrismaService } from '../../prisma/prisma.service';
import { InstallModuleDto } from './dto/install-module.dto';
import { UninstallModuleDto } from './dto/uninstall-module.dto';
import { AvailableModuleEntry, FrontendModuleManifest, PublicModuleEntry } from './module-registry.presenter';
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
   * Every module package on disk not currently installed/installing/
   * upgrading — feeds the Modules admin page's install dropdown (replacing
   * a free-text key field). Same `modules.view` gate as the plain list
   * above; no `@Audit` (read-only, discloses nothing about another user).
   */
  @Get('available')
  @RequirePermission('modules.view')
  async available(): Promise<AvailableModuleEntry[]> {
    return this.moduleRegistry.listAvailableToInstall();
  }

  /**
   * Authenticated, no `@RequirePermission` — same "logged in is enough,
   * no specific grant needed" category as `GET /users/me`/`GET /users/me/
   * landing-page-options` (root D72), NOT `@Public()` (root D79 — corrects
   * D78's original choice here). `FrontendModuleManifest` itself is
   * deliberately narrow (route patterns/menu labels, never manifest
   * internals — see its own docblock), but WHICH modules are actually
   * installed for this tenant is still real information an anonymous
   * caller has no business enumerating: the shipped JS bundle (root D78's
   * `import.meta.glob`) contains every module physically present in this
   * build regardless of install status, so a genuinely public version of
   * this endpoint would hand an anonymous visitor a strictly MORE precise
   * map of this deployment's actual attack surface (which permission codes
   * exist, which modules are live here) than static analysis of the bundle
   * alone. Only `apps/web/src/App.tsx`'s AUTHENTICATED route tree and
   * `PageLayout.tsx`'s sidebar call this; the anonymous/must-change-password
   * route trees mount every discovered module's `publicRoutes` directly
   * from the build-time glob instead (see `usePublicModuleRoutes` — a
   * public route's own underlying API 404s gracefully if that module isn't
   * actually installed, exactly as it already did before this endpoint
   * existed, so no anonymous-reachable manifest call is needed for it at all).
   */
  @Get('frontend-manifest')
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
