// Frontend module code is bundled by Vite/Rollup together with the rest of
// apps/web (this file is only ever reached via a STATIC import from
// apps/web/src/App.tsx — see that file's own comment on why no dynamic
// module-federation-style loading exists yet, BUILD_PLAN.md Phase 8's own
// note). Unlike the backend half of this module (see backend/platform.ts's
// docblock), a relative import crossing from `modules/library_catalog/`
// into `apps/web/src/**` is NOT a fragile runtime cross-process import here
// — Vite resolves and bundles the whole module graph at build/dev-serve
// time, exactly like any other same-repo TypeScript import.
import { apiClient } from '../../../apps/web/src/shared/api/httpClient';

export type BookCopyStatus = 'available' | 'borrowed' | 'lost' | 'damaged' | 'maintenance' | 'reserved';

export interface LibraryBook {
  id: string;
  title: string;
  author: string | null;
  publisher: string | null;
  category: string | null;
  readingLevel: string | null;
  language: string | null;
  description: string | null;
  coverImage: string | null;
  createdAt: string;
  updatedAt: string;
  totalCopies?: number;
  copies?: LibraryBookCopy[];
}

export interface LibraryBookCopy {
  id: string;
  bookId: string;
  qrCode: string;
  status: BookCopyStatus;
  condition: string | null;
  location: string | null;
  acquisitionDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBookInput {
  title: string;
  author?: string;
  publisher?: string;
  category?: string;
  readingLevel?: string;
  language?: string;
  description?: string;
  coverImage?: string;
}

export type UpdateBookInput = Partial<CreateBookInput>;

export interface CreateBookCopyInput {
  qrCode: string;
  status?: BookCopyStatus;
  condition?: string;
  location?: string;
  acquisitionDate?: string;
}

export interface BookAvailability {
  bookId: string;
  title: string;
  totalCopies: number;
  availableCopies: number;
}

export const libraryCatalogApi = {
  listBooks: (params?: { search?: string; category?: string }) =>
    apiClient.get<LibraryBook[]>('/api/library/books', { params }).then((r) => r.data),
  getBook: (id: string) => apiClient.get<LibraryBook>(`/api/library/books/${id}`).then((r) => r.data),
  createBook: (dto: CreateBookInput) => apiClient.post<LibraryBook>('/api/library/books', dto).then((r) => r.data),
  updateBook: (id: string, dto: UpdateBookInput) =>
    apiClient.patch<LibraryBook>(`/api/library/books/${id}`, dto).then((r) => r.data),
  removeBook: (id: string) => apiClient.delete<void>(`/api/library/books/${id}`).then((r) => r.data),
  exportBooks: () => apiClient.get<Blob>('/api/library/books/export', { responseType: 'blob' }).then((r) => r.data),

  listCopies: (bookId: string) =>
    apiClient.get<LibraryBookCopy[]>(`/api/library/books/${bookId}/copies`).then((r) => r.data),
  createCopy: (bookId: string, dto: CreateBookCopyInput) =>
    apiClient.post<LibraryBookCopy>(`/api/library/books/${bookId}/copies`, dto).then((r) => r.data),

  // Public — no Authorization header required (MODULE_SPEC.md §7); reused
  // `apiClient` still opportunistically attaches one if present (a logged-in
  // admin previewing the shareable link), but never requires it.
  getPublicAvailability: (bookId: string) =>
    apiClient.get<BookAvailability>(`/api/library/public/books/${bookId}/availability`).then((r) => r.data),
};

/** Mirrors apps/web/src/shared/api/users.ts's own download helper. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
