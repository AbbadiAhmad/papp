import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UsersService } from '../../../src/core/users/users.service';

interface MockPrisma {
  user: { findUnique: jest.Mock; update: jest.Mock };
  moduleRegistryEntry: { findMany: jest.Mock };
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'aisha@papp.local',
    name: 'Aisha',
    passwordHash: '$argon2id$existing',
    externalId: null,
    department: null,
    mustChangePassword: false,
    isActive: true,
    lastLoginAt: null,
    defaultLandingPage: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: null,
    ...overrides,
  };
}

function installedModuleRow(manifestSnapshot: Record<string, unknown>) {
  return { manifestSnapshot };
}

const LIBRARY_MANIFEST = {
  key: 'library_catalog',
  name: 'Library Catalog',
  frontend: { landingPage: '/library/books' },
  menu: [
    { route: '/library/books', labelKey: 'library_catalog.menu.root', requiredPermission: 'library_catalog.books.view' },
  ],
};

describe('UsersService — per-user default landing page', () => {
  let prisma: MockPrisma;
  let permissions: { getEffectivePermissionCodes: jest.Mock };
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      moduleRegistryEntry: { findMany: jest.fn() },
    };
    permissions = { getEffectivePermissionCodes: jest.fn() };
    service = new UsersService(prisma as never, {} as never, permissions as never, {} as never);
  });

  describe('listLandingPageOptions', () => {
    it('always offers the platform default first, even with no modules installed', async () => {
      prisma.moduleRegistryEntry.findMany.mockResolvedValue([]);
      permissions.getEffectivePermissionCodes.mockResolvedValue(new Set());

      const options = await service.listLandingPageOptions('user-1');

      expect(options).toEqual([{ value: null, labelKey: 'core.myPreferences.platformDefault', moduleKey: null }]);
    });

    it('offers an installed module landing page only when the caller holds its menu permission', async () => {
      prisma.moduleRegistryEntry.findMany.mockResolvedValue([installedModuleRow(LIBRARY_MANIFEST)]);
      permissions.getEffectivePermissionCodes.mockResolvedValue(new Set(['library_catalog.books.view']));

      const options = await service.listLandingPageOptions('user-1');

      expect(options).toContainEqual({
        value: '/library/books',
        labelKey: 'library_catalog.menu.root',
        moduleKey: 'library_catalog',
      });
    });

    it('omits an installed module landing page when the caller lacks its menu permission', async () => {
      prisma.moduleRegistryEntry.findMany.mockResolvedValue([installedModuleRow(LIBRARY_MANIFEST)]);
      permissions.getEffectivePermissionCodes.mockResolvedValue(new Set()); // no grants at all

      const options = await service.listLandingPageOptions('user-1');

      expect(options).toHaveLength(1); // platform default only
      expect(options[0].value).toBeNull();
    });
  });

  describe('setDefaultLandingPage', () => {
    it('accepts null (reset to platform default) with no options lookup needed', async () => {
      prisma.user.update.mockResolvedValue(userRow({ defaultLandingPage: null }));

      const result = await service.setDefaultLandingPage('user-1', null);

      expect(result.defaultLandingPage).toBeNull();
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { defaultLandingPage: null } });
    });

    it('accepts a module landing page the caller can currently see', async () => {
      prisma.moduleRegistryEntry.findMany.mockResolvedValue([installedModuleRow(LIBRARY_MANIFEST)]);
      permissions.getEffectivePermissionCodes.mockResolvedValue(new Set(['library_catalog.books.view']));
      prisma.user.update.mockResolvedValue(userRow({ defaultLandingPage: '/library/books' }));

      const result = await service.setDefaultLandingPage('user-1', '/library/books');

      expect(result.defaultLandingPage).toBe('/library/books');
    });

    it('rejects a route the caller has no permission to see, WITHOUT trusting the client', async () => {
      prisma.moduleRegistryEntry.findMany.mockResolvedValue([installedModuleRow(LIBRARY_MANIFEST)]);
      permissions.getEffectivePermissionCodes.mockResolvedValue(new Set()); // lacks library_catalog.books.view

      await expect(service.setDefaultLandingPage('user-1', '/library/books')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an arbitrary path that matches no installed module at all', async () => {
      prisma.moduleRegistryEntry.findMany.mockResolvedValue([]);
      permissions.getEffectivePermissionCodes.mockResolvedValue(new Set());

      await expect(service.setDefaultLandingPage('user-1', '/some/random/path')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});

describe('UsersService.resolveLandingPage — admin default', () => {
  const manifest = {
    key: 'website',
    frontend: { landingPage: '/site/admin/pages', publicLandingPage: '/site' },
    menu: [{ route: '/site/admin/pages', labelKey: 'website.menu.pages', requiredPermission: 'website.pages.view' }],
  };
  function build(opts: { pref: string | null; adminDefault: unknown; perms: string[]; modules?: unknown[] }) {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ defaultLandingPage: opts.pref }) },
      moduleRegistryEntry: { findMany: jest.fn().mockResolvedValue(opts.modules ?? [{ manifestSnapshot: manifest }]) },
    };
    const settings = { get: jest.fn().mockResolvedValue(opts.adminDefault) };
    const permissions = { getEffectivePermissionCodes: jest.fn().mockResolvedValue(new Set(opts.perms)) };
    return new UsersService(prisma as never, settings as never, permissions as never, {} as never);
  }

  it('user preference wins over the admin default', async () => {
    expect(await build({ pref: '/site/admin/pages', adminDefault: '/site', perms: ['website.pages.view'] }).resolveLandingPage('u')).toBe('/site/admin/pages');
  });
  it('uses the admin default when the user has no preference', async () => {
    expect(await build({ pref: null, adminDefault: '/site', perms: [] }).resolveLandingPage('u')).toBe('/site');
  });
  it('falls back to the Welcome page (null) when the admin default needs a permission the user lacks', async () => {
    expect(await build({ pref: null, adminDefault: '/site/admin/pages', perms: [] }).resolveLandingPage('u')).toBeNull();
  });
  it('falls back to null when the module is uninstalled', async () => {
    expect(await build({ pref: null, adminDefault: '/site', perms: [], modules: [] }).resolveLandingPage('u')).toBeNull();
  });
});
