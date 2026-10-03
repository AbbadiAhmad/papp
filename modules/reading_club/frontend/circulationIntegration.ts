// Deliberately a RAW `apiClient` call to library_circulation's own endpoint,
// never a static `import` of that module's `frontend/api.ts` — this module
// `dependsOn: ["library_circulation"]` so the direction is architecturally
// fine (it's always installed first), but keeping every cross-module
// frontend call at the same "raw endpoint + local minimal type" level (in
// both directions — see this module's own DECISIONS.md and
// library_circulation's ScanPage.tsx) means neither module's frontend
// bundle statically depends on the other module's source files existing.
import { apiClient } from '../../../apps/web/src/shared/api/httpClient';

export interface CirculationStudent {
  id: string;
  code: string;
  className: string | null;
}

export const circulationIntegration = {
  listStudents: () => apiClient.get<CirculationStudent[]>('/api/library-circulation/students').then((r) => r.data),
};
