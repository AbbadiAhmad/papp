import type { MenuLayout, ThemePack } from '@papp/shared-types';
import type { LandingPagesSettings } from './types';
import { apiClient } from './httpClient';

export const appearanceApi = {
  getActive: () => apiClient.get<{ key: string; theme: ThemePack | null }>('/appearance/active').then((r) => r.data),
  listThemes: () => apiClient.get<{ activeKey: string; themes: ThemePack[] }>('/appearance/themes').then((r) => r.data),
  setActiveTheme: (key: string) => apiClient.put<{ key: string }>('/appearance/active-theme', { key }).then((r) => r.data),
  getMenuLayout: () => apiClient.get<MenuLayout>('/appearance/menu-layout').then((r) => r.data),
  setMenuLayout: (layout: MenuLayout) => apiClient.put<MenuLayout>('/appearance/menu-layout', layout).then((r) => r.data),
  getBranding: () => apiClient.get<AppBranding>('/appearance/branding').then((r) => r.data),
  setBranding: (branding: AppBranding) => apiClient.put<AppBranding>('/appearance/branding', branding).then((r) => r.data),
  getLandingPages: () => apiClient.get<LandingPagesSettings>('/appearance/landing-pages').then((r) => r.data),
  /** A field omitted is left unchanged; `null` resets that audience to the platform default. */
  updateLandingPages: (dto: { anonymous?: string | null; authenticated?: string | null }) =>
    apiClient.put<LandingPagesSettings>('/appearance/landing-pages', dto).then((r) => r.data),
};

export interface AppBranding {
  titleAr: string;
  titleEn: string;
}
