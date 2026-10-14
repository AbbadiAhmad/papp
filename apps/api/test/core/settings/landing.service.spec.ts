import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { LandingService } from '../../../src/core/settings/landing.service';

const WEBSITE = {
  key: 'website',
  frontend: { landingPage: '/site/admin/pages', publicLandingPage: '/site', publicLandingLabelKey: 'website.landing.public' },
  menu: [{ route: '/site/admin/pages', labelKey: 'website.menu.pages' }],
};

describe('LandingService', () => {
  let prisma: { moduleRegistryEntry: { findMany: jest.Mock } };
  let settings: { get: jest.Mock; set: jest.Mock };
  let service: LandingService;

  beforeEach(() => {
    prisma = { moduleRegistryEntry: { findMany: jest.fn() } };
    settings = { get: jest.fn(), set: jest.fn() };
    prisma.moduleRegistryEntry.findMany.mockResolvedValue([{ manifestSnapshot: WEBSITE }]);
    service = new LandingService(prisma as never, settings as never);
  });

  it('anonymous: returns the stored public route while its module is installed', async () => {
    settings.get.mockResolvedValue('/site');
    expect(await service.getEffectiveAnonymous()).toBe('/site');
  });

  it('anonymous: falls back to null (login) once the module is gone', async () => {
    settings.get.mockResolvedValue('/site');
    prisma.moduleRegistryEntry.findMany.mockResolvedValue([]);
    expect(await service.getEffectiveAnonymous()).toBeNull();
  });

  it('anonymous: a non-public (admin) route is never honoured', async () => {
    settings.get.mockResolvedValue('/site/admin/pages');
    expect(await service.getEffectiveAnonymous()).toBeNull();
  });

  it('anonymous: never throws if the setting row is missing', async () => {
    settings.get.mockRejectedValue(new Error('missing'));
    expect(await service.getEffectiveAnonymous()).toBeNull();
  });

  it('authenticated: offers public and module landing routes, deduplicated, and falls back when uninstalled', async () => {
    const options = await service.authenticatedOptions();
    expect(options.map((o) => o.value)).toEqual(['/site', '/site/admin/pages']);
    settings.get.mockResolvedValue('/site/admin/pages');
    prisma.moduleRegistryEntry.findMany.mockResolvedValue([]);
    expect(await service.getEffectiveAuthenticated()).toBeNull();
  });

  it('update: rejects a route no installed module offers, accepts null to reset', async () => {
    await expect(service.update({ anonymous: '/nope' }, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    await service.update({ anonymous: null, authenticated: '/site' }, 'u1');
    expect(settings.set).toHaveBeenCalledWith('platform.landing.anonymous', null, 'u1');
    expect(settings.set).toHaveBeenCalledWith('platform.landing.authenticated', '/site', 'u1');
  });
});
