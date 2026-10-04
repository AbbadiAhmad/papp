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
  /** Optional (LIBRARY_CATALOG-D24) — reading_club sums this across a reader's stage book entries to auto-compute a `pages`-type stage's progress. */
  pageCount: number | null;
  createdAt: string;
  updatedAt: string;
  totalCopies?: number;
  availableCopies?: number;
  copies?: LibraryBookCopy[];
  averageRating?: number | null;
  ratingsCount?: number;
}

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface BookRating {
  id: string;
  userId: string;
  userName: string | null;
  rating: number;
  review: string | null;
  reviewStatus: ReviewStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MyBookRating {
  rating: number;
  review: string | null;
  reviewStatus: ReviewStatus;
}

/** One row from `GET /books/ratings/pending` — the librarian's review-moderation queue (LIBRARY_CATALOG-D21). */
export interface PendingReview {
  id: string;
  bookId: string;
  bookTitle: string | null;
  userId: string;
  userName: string | null;
  rating: number;
  review: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET /books/:id`'s enriched shape — the plain `LibraryBook` fields plus the full ratings list and the caller's own rating. */
export interface LibraryBookDetail extends LibraryBook {
  ratings: BookRating[];
  myRating: MyBookRating | null;
}

export interface RateBookInput {
  rating: number;
  review?: string;
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

export interface CreateBookCopyInlineInput {
  /** Optional (LIBRARY_CATALOG-D22) — omitted/blank auto-assigns the next Bxxxxxx code server-side. */
  qrCode?: string;
  status?: BookCopyStatus;
  condition?: string;
  location?: string;
  acquisitionDate?: string;
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
  /** Optional (LIBRARY_CATALOG-D24) — see LibraryBook's own docblock. */
  pageCount?: number;
  /** Mandatory server-side (CreateBookDto.copy, LIBRARY_CATALOG-D11) — every book is created with its first copy in the same transaction. */
  copy: CreateBookCopyInlineInput;
}

/** Book UPDATE never touches `copy` — a book's copies are their own sub-resource (create/update/delete via the `/copies` endpoints), never edited through the book PATCH. */
export type UpdateBookInput = Partial<Omit<CreateBookInput, 'copy'>>;

export interface UpdateBookCopyDto {
  status?: BookCopyStatus;
  condition?: string;
  location?: string;
  acquisitionDate?: string;
}

export interface CreateBookCopyInput {
  /** Optional (LIBRARY_CATALOG-D22) — omitted/blank auto-assigns the next Bxxxxxx code server-side. */
  qrCode?: string;
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

/** One entry from BooksService.getCopyHistory() — status/condition/location changes only (catalog-domain metadata, not borrowing history; see LIBRARY_CATALOG-D12). */
export interface CopyHistoryEntry {
  timestamp: string;
  changes: Record<string, { before: unknown; after: unknown }>;
}

/** `GET /books/copies/stickers` filter — both bounds optional/inclusive (LIBRARY_CATALOG-D22). */
export interface ListCopiesForPrintParams {
  from?: string;
  to?: string;
}

/** One row from `GET /books/copies/stickers` — `bookTitle` is for on-screen validation only, never printed on the sticker itself. */
export interface CopyForPrint {
  id: string;
  qrCode: string;
  location: string | null;
  acquisitionDate: string | null;
  bookTitle: string;
}

export interface StickerSettings {
  headerText: string;
}

/** Copies inventory page's filter bar (user request: "help the librarian on the Annual inventory"). */
export interface ListCopiesForInventoryParams {
  bookSearch?: string;
  status?: BookCopyStatus | '';
  location?: string;
}

/** One row from `GET /books/copies/inventory`. */
export interface CopyForInventory {
  id: string;
  qrCode: string;
  bookTitle: string;
  location: string | null;
  status: BookCopyStatus;
  condition: string | null;
}

export const libraryCatalogApi = {
  listBooks: (params?: { search?: string; category?: string }) =>
    apiClient.get<LibraryBook[]>('/api/library/books', { params }).then((r) => r.data),
  getBook: (id: string) => apiClient.get<LibraryBookDetail>(`/api/library/books/${id}`).then((r) => r.data),
  createBook: (dto: CreateBookInput) => apiClient.post<LibraryBook>('/api/library/books', dto).then((r) => r.data),
  updateBook: (id: string, dto: UpdateBookInput) =>
    apiClient.patch<LibraryBook>(`/api/library/books/${id}`, dto).then((r) => r.data),
  removeBook: (id: string) => apiClient.delete<void>(`/api/library/books/${id}`).then((r) => r.data),
  exportBooks: () => apiClient.get<Blob>('/api/library/books/export', { responseType: 'blob' }).then((r) => r.data),

  /** Read-only suggested next `Bxxxxxx` code (LIBRARY_CATALOG-D22 follow-up) — does NOT consume the sequence, so cancelling the form burns nothing. */
  peekNextCopyCode: () => apiClient.get<{ qrCode: string }>('/api/library/books/copies/next-code').then((r) => r.data.qrCode),
  listCopies: (bookId: string) =>
    apiClient.get<LibraryBookCopy[]>(`/api/library/books/${bookId}/copies`).then((r) => r.data),
  createCopy: (bookId: string, dto: CreateBookCopyInput) =>
    apiClient.post<LibraryBookCopy>(`/api/library/books/${bookId}/copies`, dto).then((r) => r.data),
  updateCopy: (bookId: string, copyId: string, dto: UpdateBookCopyDto) =>
    apiClient.patch<LibraryBookCopy>(`/api/library/books/${bookId}/copies/${copyId}`, dto).then((r) => r.data),
  removeCopy: (bookId: string, copyId: string) =>
    apiClient.delete<void>(`/api/library/books/${bookId}/copies/${copyId}`).then((r) => r.data),
  getCopyHistory: (bookId: string, copyId: string, limit = 10) =>
    apiClient
      .get<CopyHistoryEntry[]>(`/api/library/books/${bookId}/copies/${copyId}/catalog-history`, { params: { limit } })
      .then((r) => r.data),

  rateBook: (bookId: string, dto: RateBookInput) =>
    apiClient.put<BookRating>(`/api/library/books/${bookId}/rating`, dto).then((r) => r.data),
  removeRating: (bookId: string) => apiClient.delete<void>(`/api/library/books/${bookId}/rating`).then((r) => r.data),

  // Review moderation (LIBRARY_CATALOG-D21) — "the librarian has to approve the comments to publish it".
  listPendingReviews: () => apiClient.get<PendingReview[]>('/api/library/books/ratings/pending').then((r) => r.data),
  approveReview: (ratingId: string) => apiClient.post<BookRating>(`/api/library/books/ratings/${ratingId}/approve`).then((r) => r.data),
  rejectReview: (ratingId: string) => apiClient.post<BookRating>(`/api/library/books/ratings/${ratingId}/reject`).then((r) => r.data),

  // Public — no Authorization header required (MODULE_SPEC.md §7); reused
  // `apiClient` still opportunistically attaches one if present (a logged-in
  // admin previewing the shareable link), but never requires it.
  getPublicAvailability: (bookId: string) =>
    apiClient.get<BookAvailability>(`/api/library/public/books/${bookId}/availability`).then((r) => r.data),

  // Print Codes / stickers (LIBRARY_CATALOG-D22).
  listCopiesForPrint: (params?: ListCopiesForPrintParams) =>
    apiClient.get<CopyForPrint[]>('/api/library/books/copies/stickers', { params }).then((r) => r.data),
  exportCopiesForPrint: (params?: ListCopiesForPrintParams) =>
    apiClient.get<Blob>('/api/library/books/copies/stickers/export', { params, responseType: 'blob' }).then((r) => r.data),
  getStickerSettings: () => apiClient.get<StickerSettings>('/api/library/settings/sticker').then((r) => r.data),
  updateStickerSettings: (dto: StickerSettings) =>
    apiClient.put<StickerSettings>('/api/library/settings/sticker', dto).then((r) => r.data),

  // Copies inventory (user request: annual inventory walkthrough).
  listCopiesForInventory: (params?: ListCopiesForInventoryParams) => {
    const cleaned = params ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')) : undefined;
    return apiClient.get<CopyForInventory[]>('/api/library/books/copies/inventory', { params: cleaned }).then((r) => r.data);
  },
  exportCopiesForInventory: (params?: ListCopiesForInventoryParams) => {
    const cleaned = params ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')) : undefined;
    return apiClient.get<Blob>('/api/library/books/copies/inventory/export', { params: cleaned, responseType: 'blob' }).then((r) => r.data);
  },
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
