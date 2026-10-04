// Same-repo Vite import — see modules/template/frontend/api.ts's own docblock.
import { apiClient } from '../../../apps/web/src/shared/api/httpClient';

export type BorrowingStatus = 'active' | 'returned' | 'overdue' | 'lost' | 'cancelled';
export type FineStatus = 'unpaid' | 'partially_paid' | 'paid' | 'waived' | 'cancelled';
export type PaymentMethod = 'cash' | 'card' | 'transfer';
export type ReturnStatus = 'returned' | 'damaged' | 'lost' | 'other';

export interface LibraryStudent {
  id: string;
  userId: string;
  code: string;
  className: string | null;
  academicYearId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Joined in from the linked platform User (D41: name lives on User, not libraryStudent) — StudentsService.list(). */
  name: string | null;
}

/** StudentsService.search() result row — lightweight, for the searchable reader picker. */
export interface StudentSearchResult {
  id: string;
  userId: string;
  code: string;
  className: string | null;
  name: string | null;
}

/** CirculationService.getActiveBorrowingsForStudent() — Scan page's reader-centric active-borrowings list. */
export interface ActiveBorrowingForStudent {
  id: string;
  bookCopyId: string;
  qrCode: string | null;
  bookTitle: string | null;
  borrowedAt: string;
  dueAt: string;
  status: BorrowingStatus;
  isOverdue: boolean;
}

export interface LibraryStudentDetail extends LibraryStudent {
  email: string | null;
  isActive: boolean;
  activeBorrowingsCount: number;
  unpaidFinesTotal: number;
  paidFinesTotal: number;
  activeBorrowings: (LibraryBorrowing & BookInfo)[];
  openFines: LibraryFine[];
}

/** StudentsService.getActionHistory()'s resolved shape — actor and field names, never a raw actorUserId/column dump. */
export interface StudentActionHistoryEntry {
  id: string;
  occurredAt: string;
  actorType: string;
  actorName: string | null;
  action: string;
  changes: { field: string; before: unknown; after: unknown }[];
}

/** A book's title/level/qrCode, joined in server-side onto a borrowing row — libraryBorrowing itself only stores bookCopyId. */
export interface BookInfo {
  qrCode: string | null;
  bookTitle: string | null;
  readingLevel: string | null;
  category: string | null;
}

export interface CreatedStudent extends LibraryStudent {
  name: string;
  email: string;
  temporaryPassword: string;
}

export interface CreateStudentInput {
  name: string;
  email: string;
  code: string;
  className?: string;
  academicYearId?: string;
}

export type UpdateStudentInput = Partial<Pick<CreateStudentInput, 'code' | 'className' | 'academicYearId'>>;

export interface LibraryBorrowing {
  id: string;
  bookCopyId: string;
  studentId: string;
  status: BorrowingStatus;
  borrowedAt: string;
  dueAt: string;
  returnedAt: string | null;
  borrowedBy: string;
  returnedBy: string | null;
  comments?: string | null;
}

/** CirculationService.getCirculationHistory() — a copy's last N borrowings. */
export interface CopyCirculationHistoryEntry {
  id: string;
  studentId: string;
  studentCode: string;
  borrowedAt: string;
  dueAt: string;
  returnedAt: string | null;
  status: BorrowingStatus;
  comments: string | null;
  borrowedBy: string;
  returnedBy: string | null;
}

/** CirculationService.getBookCirculationHistory() — every reader who borrowed any copy of a book, most recent first (§2.1). */
export interface BookCirculationHistoryEntry {
  id: string;
  studentId: string;
  studentCode: string;
  studentName: string | null;
  bookCopyId: string;
  qrCode: string | null;
  borrowedAt: string;
  dueAt: string;
  returnedAt: string | null;
  status: BorrowingStatus;
}

export interface LibraryFineType {
  id: string;
  code: string;
  name: string;
  defaultAmount: string;
  isActive: boolean;
}

export interface LibraryFine {
  id: string;
  fineNumber: string;
  studentId: string;
  borrowingId: string | null;
  fineTypeId: string;
  status: FineStatus;
  amount: string;
  amountPaid: string;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

export interface CreateFineInput {
  studentId: string;
  fineTypeId: string;
  amount: number;
  borrowingId?: string;
  notes?: string;
  confirmDuplicate?: boolean;
}

export interface UpdateFineInput {
  amount?: number;
  notes?: string;
}

/** FinesService.findById()'s enrichment — book/return context a raw LibraryFine can't show on its own (it only stores borrowingId), and both createdBy/receivedBy resolved to real names. */
export interface FineBorrowingContext {
  bookTitle: string | null;
  qrCode: string | null;
  returnStatus: string | null;
  dueAt: string;
  returnedAt: string | null;
  daysLate: number;
}

/** Fines page's filter bar — all optional, combined with AND. */
export interface FineFilterInput {
  studentId?: string;
  /** Multi-select — sent to the backend as a comma-separated string (ListFinesDto). */
  status?: FineStatus[];
  fineTypeId?: string;
  dateFrom?: string;
  dateTo?: string;
  createdByName?: string;
  studentSearch?: string;
  amountMin?: number;
  amountMax?: number;
}

/** FinesService.list()'s enriched row — resolved reader/creator/fine-type names, never just raw ids. */
export interface EnrichedFine extends LibraryFine {
  createdByName: string | null;
  studentCode: string | null;
  studentName: string | null;
  fineTypeName: string | null;
}

export interface LibraryFineDetail extends LibraryFine {
  createdByName: string | null;
  transaction: LibraryFinancialTransaction | null;
  payments: (LibraryPayment & { receivedByName: string | null })[];
  borrowingContext: FineBorrowingContext | null;
}

/** Return dialog's inline extendable "add fine" checkbox. */
export interface ReturnFineInput {
  fineTypeId: string;
  amount: number;
  notes?: string;
}

export interface ScanStudentResult {
  type: 'student';
  student: LibraryStudent & { name: string | null; email: string | null };
  activeBorrowingsCount: number;
}

export interface ScanBookCopyResult {
  type: 'book_copy';
  copy: { id: string; bookId: string; qrCode: string; status: string };
  book: { id: string; title: string } | null;
  activeBorrowing: LibraryBorrowing | null;
}

export type ScanResult = ScanStudentResult | ScanBookCopyResult;

export interface LoanPolicy {
  maxBooksPerStudent: number;
  loanPeriodDays: number;
  finePerDay: number;
}

export interface LibraryFinancialTransaction {
  id: string;
  fineId: string;
  transactionNumber: string;
  amount: string;
  createdAt: string;
}

export interface LibraryPayment {
  id: string;
  paymentNumber: string;
  transactionId: string;
  amount: string;
  paymentMethod: PaymentMethod;
  paidAt: string;
  receivedBy: string;
}

export interface LibraryReceipt {
  id: string;
  paymentId: string;
  receiptNumber: string;
  issuedAt: string;
}

/** Finance page's Payments tab filters — all optional, combined with AND. */
export interface PaymentFilterInput {
  dateFrom?: string;
  dateTo?: string;
  createdByName?: string;
  receivedByName?: string;
}

/** FinesService.listPayments()'s enriched row — resolved names + the fine it belongs to, never just the raw receivedBy UUID. */
export interface EnrichedPayment extends LibraryPayment {
  receivedByName: string | null;
  fineNumber: string;
  fineAmount: string;
  createdBy: string;
  createdByName: string | null;
}

export interface DashboardStats {
  students: number;
  totalCopies: number;
  availableCopies: number;
  borrowedCopies: number;
  overdueBorrowings: number;
  unpaidFinesTotal: number;
  paidFinesTotal: number;
}

const BASE = '/api/library-circulation';

export const libraryCirculationApi = {
  // Scan / borrow / return
  scan: (code: string) => apiClient.post<ScanResult>(`${BASE}/scan`, { code }).then((r) => r.data),
  activeBorrowingForCopy: (copyId: string) =>
    apiClient.get<LibraryBorrowing>(`${BASE}/book-copies/${copyId}/active-borrowing`).then((r) => r.data),
  borrow: (studentId: string, bookCopyId: string, expectedReturnDate?: string, comments?: string) =>
    apiClient.post<LibraryBorrowing>(`${BASE}/borrow`, { studentId, bookCopyId, expectedReturnDate, comments }).then((r) => r.data),
  returnBorrowing: (borrowingId: string, returnStatus?: string, returnNotes?: string, returnedAt?: string, fine?: ReturnFineInput) =>
    apiClient
      .post<{
        borrowing: LibraryBorrowing;
        daysLate: number;
        lateFine: LibraryFine | null;
        recordedFine: LibraryFine | null;
        damageFine?: { suggested: boolean; reason: string };
      }>(`${BASE}/return`, { borrowingId, returnStatus, returnNotes, returnedAt, fine })
      .then((r) => r.data),
  extendLoan: (borrowingId: string, newDueDate: string) =>
    apiClient.post<LibraryBorrowing>(`${BASE}/extend`, { borrowingId, newDueDate }).then((r) => r.data),

  // History (§2.1/§2.2, docs/LIBRARY_IMPROVEMENTS.md)
  getCopyCirculationHistory: (copyId: string, limit = 10) =>
    apiClient.get<CopyCirculationHistoryEntry[]>(`${BASE}/copies/${copyId}/circulation-history`, { params: { limit } }).then((r) => r.data),
  getBookCirculationHistory: (bookId: string, limit = 10) =>
    apiClient.get<BookCirculationHistoryEntry[]>(`${BASE}/books/${bookId}/circulation-history`, { params: { limit } }).then((r) => r.data),

  // Students
  listStudents: () => apiClient.get<LibraryStudent[]>(`${BASE}/students`).then((r) => r.data),
  searchStudents: (q: string) => apiClient.get<StudentSearchResult[]>(`${BASE}/students/search`, { params: { q } }).then((r) => r.data),
  getActiveBorrowingsForStudent: (studentId: string) =>
    apiClient.get<ActiveBorrowingForStudent[]>(`${BASE}/students/${studentId}/active-borrowings`).then((r) => r.data),
  getStudent: (id: string) => apiClient.get<LibraryStudentDetail>(`${BASE}/students/${id}`).then((r) => r.data),
  getStudentReadingHistory: (id: string) =>
    apiClient.get<(LibraryBorrowing & BookInfo)[]>(`${BASE}/students/${id}/reading-history`).then((r) => r.data),
  getStudentActionHistory: (id: string) => apiClient.get<StudentActionHistoryEntry[]>(`${BASE}/students/${id}/action-history`).then((r) => r.data),
  createStudent: (dto: CreateStudentInput) => apiClient.post<CreatedStudent>(`${BASE}/students`, dto).then((r) => r.data),
  updateStudent: (id: string, dto: UpdateStudentInput) =>
    apiClient.patch<LibraryStudent>(`${BASE}/students/${id}`, dto).then((r) => r.data),
  removeStudent: (id: string) => apiClient.delete<void>(`${BASE}/students/${id}`).then((r) => r.data),

  // Fines / finance
  listFineTypes: () => apiClient.get<LibraryFineType[]>(`${BASE}/fine-types`).then((r) => r.data),
  listFines: (filter: FineFilterInput = {}) => {
    // `status` is sent as ONE comma-joined query value (`?status=unpaid,partially_paid`),
    // not a repeated-key array — matches ListFinesDto's own `@Transform` (splits on ','),
    // and keeps the dashboard's deep-link URLs (e.g. `?status=unpaid,partially_paid`)
    // working identically whether built here or typed by hand.
    const { status, ...rest } = filter;
    const params: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== ''));
    if (status && status.length > 0) params.status = status.join(',');
    return apiClient.get<{ fines: EnrichedFine[]; totalAmount: number }>(`${BASE}/fines`, { params }).then((r) => r.data);
  },
  getFine: (id: string) => apiClient.get<LibraryFineDetail>(`${BASE}/fines/${id}`).then((r) => r.data),
  createFine: (dto: CreateFineInput) => apiClient.post<LibraryFine>(`${BASE}/fines`, dto).then((r) => r.data),
  /** Editable while unpaid/partially_paid, under the same permission that creates a fine. */
  updateFine: (id: string, dto: UpdateFineInput) => apiClient.patch<LibraryFine>(`${BASE}/fines/${id}`, dto).then((r) => r.data),
  /** Editing an already-fully-paid fine — a distinct, more privileged permission than updateFine above. */
  updateFineAfterPayment: (id: string, dto: UpdateFineInput) =>
    apiClient.patch<LibraryFine>(`${BASE}/fines/${id}/after-payment`, dto).then((r) => r.data),
  waiveFine: (id: string) => apiClient.post<LibraryFine>(`${BASE}/fines/${id}/waive`).then((r) => r.data),
  recordPayment: (fineId: string, amount: number, paymentMethod: PaymentMethod) =>
    apiClient
      .post<{ payment: LibraryPayment; receipt: LibraryReceipt; fine: LibraryFine }>(`${BASE}/fines/${fineId}/payments`, {
        amount,
        paymentMethod,
      })
      .then((r) => r.data),
  listTransactions: () => apiClient.get<LibraryFinancialTransaction[]>(`${BASE}/finance/transactions`).then((r) => r.data),
  listPayments: (filter: PaymentFilterInput = {}) => {
    const params = Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined && v !== ''));
    return apiClient
      .get<{ payments: EnrichedPayment[]; totalAmount: number }>(`${BASE}/finance/payments`, { params })
      .then((r) => r.data);
  },
  exportPayments: (filter: PaymentFilterInput = {}) => {
    const params = Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined && v !== ''));
    return apiClient.get<Blob>(`${BASE}/finance/payments/export`, { params, responseType: 'blob' }).then((r) => r.data);
  },

  // Dashboard
  getDashboardStats: () => apiClient.get<DashboardStats>(`${BASE}/dashboard`).then((r) => r.data),

  // Settings
  getLoanPolicy: () => apiClient.get<LoanPolicy>(`${BASE}/settings/loan-policy`).then((r) => r.data),
  updateLoanPolicy: (dto: LoanPolicy) => apiClient.put<LoanPolicy>(`${BASE}/settings/loan-policy`, dto).then((r) => r.data),
};

/** Mirrors library_catalog/frontend/api.ts's own copy of this helper (that one in turn mirrors apps/web/src/shared/api/users.ts) — small enough, and domain-specific enough, that each module keeps its own rather than importing across module boundaries. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
