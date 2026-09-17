// Same-repo Vite import — see modules/template/frontend/api.ts's own docblock.
import { apiClient } from '../../../apps/web/src/shared/api/httpClient';

export type PageStatus = 'draft' | 'published';
export type BlockType = 'hero' | 'text' | 'image' | 'columns' | 'button' | 'spacer';
export type MenuLocation = 'header' | 'footer';

export interface HeroConfig {
  heading: string;
  subheading?: string;
  imageUrl?: string;
}
export interface TextConfig {
  markdown: string;
}
export interface ImageConfig {
  imageUrl: string;
  alt?: string;
}
export interface ColumnsConfig {
  left: { heading: string; text: string };
  right: { heading: string; text: string };
}
export interface ButtonConfig {
  label: string;
  url: string;
}
export interface SpacerConfig {
  height: number;
}

export interface WebsiteBlock {
  id: string;
  pageId: string;
  orderIndex: number;
  type: BlockType;
  config: HeroConfig | TextConfig | ImageConfig | ColumnsConfig | ButtonConfig | SpacerConfig;
}

export interface BlockInput {
  id: string;
  orderIndex: number;
  type: BlockType;
  config: WebsiteBlock['config'];
}

export interface WebsitePage {
  id: string;
  slug: string;
  title: string;
  status: PageStatus;
  isHomepage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebsitePageDetail extends WebsitePage {
  blocks: WebsiteBlock[];
}

export interface CreatePageInput {
  slug: string;
  title: string;
}

export interface UpdatePageInput {
  slug?: string;
  title?: string;
  isHomepage?: boolean;
}

export interface WebsiteMenuItem {
  id: string;
  location: MenuLocation;
  label: string;
  urlOrSlug: string;
  orderIndex: number;
  parentId: string | null;
}

export interface MenuItemInput {
  id: string;
  label: string;
  urlOrSlug: string;
  orderIndex: number;
  parentId?: string;
}

export interface SiteConfig {
  siteTitle: string;
  logoUrl: string | null;
}

const BASE = '/api/website';

export const websiteApi = {
  // Admin — pages
  listPages: () => apiClient.get<WebsitePage[]>(`${BASE}/pages`).then((r) => r.data),
  getPage: (id: string) => apiClient.get<WebsitePageDetail>(`${BASE}/pages/${id}`).then((r) => r.data),
  createPage: (dto: CreatePageInput) => apiClient.post<WebsitePage>(`${BASE}/pages`, dto).then((r) => r.data),
  updatePage: (id: string, dto: UpdatePageInput) => apiClient.patch<WebsitePage>(`${BASE}/pages/${id}`, dto).then((r) => r.data),
  removePage: (id: string) => apiClient.delete<void>(`${BASE}/pages/${id}`).then((r) => r.data),
  publishPage: (id: string) => apiClient.post<WebsitePage>(`${BASE}/pages/${id}/publish`).then((r) => r.data),
  unpublishPage: (id: string) => apiClient.post<WebsitePage>(`${BASE}/pages/${id}/unpublish`).then((r) => r.data),
  replaceBlocks: (id: string, blocks: BlockInput[]) =>
    apiClient.put<WebsiteBlock[]>(`${BASE}/pages/${id}/blocks`, { blocks }).then((r) => r.data),

  // Admin — menus
  listMenu: (location: MenuLocation) => apiClient.get<WebsiteMenuItem[]>(`${BASE}/menus/${location}`).then((r) => r.data),
  replaceMenu: (location: MenuLocation, items: MenuItemInput[]) =>
    apiClient.put<WebsiteMenuItem[]>(`${BASE}/menus/${location}`, { items }).then((r) => r.data),

  // Admin — settings
  getSiteConfig: () => apiClient.get<SiteConfig>(`${BASE}/settings/site-config`).then((r) => r.data),
  updateSiteConfig: (dto: SiteConfig) => apiClient.put<SiteConfig>(`${BASE}/settings/site-config`, dto).then((r) => r.data),

  // Public — no Authorization header required (MODULE_SPEC.md §7)
  getPublicPage: (slug: string) => apiClient.get<WebsitePageDetail>(`${BASE}/public/pages/${slug}`).then((r) => r.data),
  getPublicHomepage: () => apiClient.get<WebsitePageDetail>(`${BASE}/public/homepage`).then((r) => r.data),
  getPublicMenu: (location: MenuLocation) => apiClient.get<WebsiteMenuItem[]>(`${BASE}/public/menus/${location}`).then((r) => r.data),
  getPublicSiteConfig: () => apiClient.get<SiteConfig>(`${BASE}/public/site-config`).then((r) => r.data),
};

export function emptyConfigFor(type: BlockType): WebsiteBlock['config'] {
  switch (type) {
    case 'hero':
      return { heading: '', subheading: '', imageUrl: '' };
    case 'text':
      return { markdown: '' };
    case 'image':
      return { imageUrl: '', alt: '' };
    case 'columns':
      return { left: { heading: '', text: '' }, right: { heading: '', text: '' } };
    case 'button':
      return { label: '', url: '' };
    case 'spacer':
      return { height: 40 };
  }
}
