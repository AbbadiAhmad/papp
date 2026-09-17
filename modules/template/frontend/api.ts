// Same-repo Vite import, bundled with the rest of apps/web — see
// modules/library_catalog/frontend/api.ts's own docblock for why this is
// NOT the fragile cross-process import the backend half needs (D57).
import { apiClient } from '../../../apps/web/src/shared/api/httpClient';

export type TemplateItemStatus = 'active' | 'archived';

export interface TemplateItem {
  id: string;
  title: string;
  description: string | null;
  status: TemplateItemStatus;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateItemInput {
  title: string;
  description?: string;
  status?: TemplateItemStatus;
}

export type UpdateItemInput = Partial<CreateItemInput>;

export interface PublicTemplateItem {
  id: string;
  title: string;
  description: string | null;
}

export interface TemplateDefaults {
  defaultStatus: TemplateItemStatus;
}

export const templateApi = {
  list: () => apiClient.get<TemplateItem[]>('/api/template/items').then((r) => r.data),
  get: (id: string) => apiClient.get<TemplateItem>(`/api/template/items/${id}`).then((r) => r.data),
  create: (dto: CreateItemInput) => apiClient.post<TemplateItem>('/api/template/items', dto).then((r) => r.data),
  update: (id: string, dto: UpdateItemInput) => apiClient.patch<TemplateItem>(`/api/template/items/${id}`, dto).then((r) => r.data),
  remove: (id: string) => apiClient.delete<void>(`/api/template/items/${id}`).then((r) => r.data),

  // Public — no Authorization header required (MODULE_SPEC.md §7); reused
  // `apiClient` still opportunistically attaches one if present.
  getPublicItem: (id: string) => apiClient.get<PublicTemplateItem>(`/api/template/public/items/${id}`).then((r) => r.data),

  getDefaults: () => apiClient.get<TemplateDefaults>('/api/template/settings/defaults').then((r) => r.data),
  updateDefaults: (dto: TemplateDefaults) => apiClient.put<TemplateDefaults>('/api/template/settings/defaults', dto).then((r) => r.data),
};
