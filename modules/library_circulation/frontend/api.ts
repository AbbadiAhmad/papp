// Same-repo Vite import — see modules/template/frontend/api.ts's own docblock.
import { apiClient } from '../../../apps/web/src/shared/api/httpClient';

export type BorrowingStatus = 'active' | 'returned' | 'overdue' | 'lost' | 'cancelled';
export type FineStatus = 'unpaid' | 'partially_paid' | 'paid' | 'waived' | 'cancelled';
export type PaymentMethod = 'cash' | 'card' | 'transfer';

export interface LibraryStudent {
  id: string;
  userId: string;
  code: string;
  className: string | null;
  academicYearId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryStudentDetail extends LibraryStudent {
  activeBorrowings: LibraryBorrowing[];
  openFines: LibraryFine[];
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
  returnBorrowing: (borrowingId: string) =>
    apiClient
      .post<{ borrowing: LibraryBorrowing; daysLate: number; lateFine: LibraryFine | null }>(`${BASE}/return`, { borrowingId })
      .then((r) => r.data),

  // Students
  listStudents: () => apiClient.get<LibraryStudent[]>(`${BASE}/students`).then((r) => r.data),
  getStudent: (id: string) => apiClient.get<LibraryStudentDetail>(`${BASE}/students/${id}`).then((r) => r.data),
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
