import type { MenuLayout, ThemePack } from '@papp/shared-types';
import { apiClient } from './httpClient';

export const appearanceApi = {
  getActive: () => apiClient.get<{ key: string; theme: ThemePack | null }>('/appearance/active').then((r) => r.data),
  listThemes: () => apiClient.get<{ activeKey: string; themes: ThemePack[] }>('/appearance/themes').then((r) => r.data),
  setActiveTheme: (key: string) => apiClient.put<{ key: string }>('/appearance/active-theme', { key }).then((r) => r.data),
  getMenuLayout: () => apiClient.get<MenuLayout>('/appearance/menu-layout').then((r) => r.data),
  setMenuLayout: (layout: MenuLayout) => apiClient.put<MenuLayout>('/appearance/menu-layout', layout).then((r) => r.data),
};
