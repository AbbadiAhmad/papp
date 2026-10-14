import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from './settings.service';
import { LANDING_ANONYMOUS_KEY, LANDING_AUTHENTICATED_KEY } from './settings.types';

export interface LandingRouteOption {
  value: string;
  labelKey: string;
  moduleKey: string;
}

interface ManifestSlice {
  key: string;
  frontend?: { landingPage?: unknown; publicLandingPage?: unknown; publicLandingLabelKey?: unknown };
  menu?: Array<{ route: string; labelKey: string }>;
}

/**
 * Admin-configured landing pages. Always re-resolved against the CURRENTLY
 * installed modules, so a stored route whose module was uninstalled/disabled
 * silently stops applying and the platform default (login / Welcome) returns.
 * Never throws on the read paths — they sit on the login path.
 */
@Injectable()
export class LandingService {
  private readonly logger = new Logger(LandingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async installedManifests(): Promise<ManifestSlice[]> {
    const rows = await this.prisma.moduleRegistryEntry.findMany({ where: { status: 'installed' } });
    return rows.map((r) => r.manifestSnapshot as unknown as ManifestSlice).filter((m): m is ManifestSlice => !!m && typeof m.key === 'string');
  }

  /** Routes that need no login — valid for both audiences. */
  async publicOptions(): Promise<LandingRouteOption[]> {
    const options: LandingRouteOption[] = [];
    for (const m of await this.installedManifests()) {
      const route = m.frontend?.publicLandingPage;
      if (typeof route !== 'string') continue;
      const label = m.frontend?.publicLandingLabelKey;
      options.push({ value: route, labelKey: typeof label === 'string' ? label : `${m.key}.menu.root`, moduleKey: m.key });
    }
    return options;
  }

  /** Every module landing route (permission-gated ones included — the per-user check happens in UsersService). */
  async authenticatedOptions(): Promise<LandingRouteOption[]> {
    const options = await this.publicOptions();
    for (const m of await this.installedManifests()) {
      const route = m.frontend?.landingPage;
      if (typeof route !== 'string' || options.some((o) => o.value === route)) continue;
      const entry = m.menu?.find((e) => e.route === route);
      options.push({ value: route, labelKey: entry?.labelKey ?? `${m.key}.menu.root`, moduleKey: m.key });
    }
    return options;
  }

  private async readStored(key: string): Promise<string | null> {
    try {
      const value = await this.settings.get<string | null>(key);
      return typeof value === 'string' ? value : null;
    } catch (error) {
      this.logger.warn(`Could not read ${key}: ${String(error)}`);
      return null;
    }
  }

  /** Stored value if it still resolves to an installed module's public landing route, else null (= login page). */
  async getEffectiveAnonymous(): Promise<string | null> {
    const stored = await this.readStored(LANDING_ANONYMOUS_KEY);
    if (!stored) return null;
    return (await this.publicOptions()).some((o) => o.value === stored) ? stored : null;
  }

  /** Stored value if it still exists (not yet permission-checked), else null (= Welcome page). */
  async getEffectiveAuthenticated(): Promise<string | null> {
    const stored = await this.readStored(LANDING_AUTHENTICATED_KEY);
    if (!stored) return null;
    return (await this.authenticatedOptions()).some((o) => o.value === stored) ? stored : null;
  }

  async getAdminView() {
    return {
      anonymous: await this.getEffectiveAnonymous(),
      authenticated: await this.getEffectiveAuthenticated(),
      anonymousOptions: await this.publicOptions(),
      authenticatedOptions: await this.authenticatedOptions(),
    };
  }

  async update(dto: { anonymous?: string | null; authenticated?: string | null }, updatedBy: string) {
    if (dto.anonymous !== undefined) {
      if (dto.anonymous !== null && !(await this.publicOptions()).some((o) => o.value === dto.anonymous)) {
        throw new BadRequestException(`"${dto.anonymous}" is not an available public landing page.`);
      }
      await this.settings.set(LANDING_ANONYMOUS_KEY, dto.anonymous, updatedBy);
    }
    if (dto.authenticated !== undefined) {
      if (dto.authenticated !== null && !(await this.authenticatedOptions()).some((o) => o.value === dto.authenticated)) {
        throw new BadRequestException(`"${dto.authenticated}" is not an available landing page.`);
      }
      await this.settings.set(LANDING_AUTHENTICATED_KEY, dto.authenticated, updatedBy);
    }
    return this.getAdminView();
  }
}
