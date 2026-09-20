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
  name: string | null;
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
  returnBorrowing: (borrowingId: string, returnStatus?: string, returnNotes?: string) =>
    apiClient
      .post<{ borrowing: LibraryBorrowing; daysLate: number; lateFine: LibraryFine | null; damageFine?: { suggested: boolean; reason: string } }>(
        `${BASE}/return`,
        { borrowingId, returnStatus, returnNotes },
      )
      .then((r) => r.data),

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
  listFines: (filter: { studentId?: string; status?: string } = {}) => {
    const params = Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined));
    return apiClient.get<LibraryFine[]>(`${BASE}/fines`, { params }).then((r) => r.data);
  },
  getFine: (id: string) =>
    apiClient
      .get<LibraryFine & { transaction: LibraryFinancialTransaction | null; payments: LibraryPayment[] }>(`${BASE}/fines/${id}`)
      .then((r) => r.data),
  createFine: (dto: CreateFineInput) => apiClient.post<LibraryFine>(`${BASE}/fines`, dto).then((r) => r.data),
  waiveFine: (id: string) => apiClient.post<LibraryFine>(`${BASE}/fines/${id}/waive`).then((r) => r.data),
  recordPayment: (fineId: string, amount: number, paymentMethod: PaymentMethod) =>
    apiClient
      .post<{ payment: LibraryPayment; receipt: LibraryReceipt; fine: LibraryFine }>(`${BASE}/fines/${fineId}/payments`, {
        amount,
        paymentMethod,
      })
      .then((r) => r.data),
  listTransactions: () => apiClient.get<LibraryFinancialTransaction[]>(`${BASE}/finance/transactions`).then((r) => r.data),
  listPayments: () => apiClient.get<LibraryPayment[]>(`${BASE}/finance/payments`).then((r) => r.data),

  // Dashboard
  getDashboardStats: () => apiClient.get<DashboardStats>(`${BASE}/dashboard`).then((r) => r.data),

  // Settings
  getLoanPolicy: () => apiClient.get<LoanPolicy>(`${BASE}/settings/loan-policy`).then((r) => r.data),
  updateLoanPolicy: (dto: LoanPolicy) => apiClient.put<LoanPolicy>(`${BASE}/settings/loan-policy`, dto).then((r) => r.data),
};
