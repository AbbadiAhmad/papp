import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import circulationEn from '../../locales/en.json';

const api = vi.hoisted(() => ({
  scan: vi.fn(),
  borrow: vi.fn(),
  getLoanPolicy: vi.fn(),
  getActiveBorrowingsForStudent: vi.fn(),
  listFines: vi.fn(),
  getCopyCirculationHistory: vi.fn(),
  getStudent: vi.fn(),
  searchStudents: vi.fn(),
  returnBorrowing: vi.fn(),
  listFineTypes: vi.fn(),
  getStudentIncidents: vi.fn(),
  searchBookCopies: vi.fn(),
}));

vi.mock('../../frontend/api', () => ({ libraryCirculationApi: api }));
vi.mock('../../frontend/readingClubIntegration', () => ({ readingClubIntegration: { getPendingRewards: vi.fn(async () => []), confirmReward: vi.fn() } }));
vi.mock('../../../../apps/web/src/app/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', mustChangePassword: false, hasPermission: () => true }),
}));
vi.mock('../../../../apps/web/src/app/LanguageContext', () => ({ useLanguage: () => ({ language: 'en', direction: 'ltr' }) }));
vi.mock('../../../../apps/web/src/shared/modules/useInstalledModules', () => ({ useModuleFrontendManifests: () => [] }));
vi.mock('../../../../apps/web/src/shared/permissions', () => ({
  Can: ({ children }: { children: unknown }) => children,
  useGatedCall: () => (_code: string, fn: () => unknown) => fn(),
}));
vi.mock('../../frontend/pages/CameraScanDialog', () => ({ CameraScanDialog: () => null }));
vi.mock('../../frontend/pages/CopyHistoryDialog', () => ({ CopyHistoryDialog: () => null }));
vi.mock('../../frontend/pages/ReaderHistoryDialog', () => ({ ReaderHistoryDialog: () => null }));

import { ScanPage } from '../../frontend/pages/ScanPage';

const READER = { type: 'student', student: { id: 'r1', code: 'R000001', name: 'Layla', className: '5A' }, activeBorrowingsCount: 0 };
const bookCopy = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  type: 'book_copy',
  copy: { id, bookId: `bk-${id}`, qrCode: `B${id}`, status: 'available' },
  book: { id: `bk-${id}`, title },
  activeBorrowing: null,
  ...extra,
});

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', circulationEn, true, true);
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  api.getLoanPolicy.mockResolvedValue({ maxBooksPerStudent: 3, loanPeriodDays: 14, finePerDay: 0 });
  api.getActiveBorrowingsForStudent.mockResolvedValue([]);
  api.listFines.mockResolvedValue({ fines: [] });
  api.getCopyCirculationHistory.mockResolvedValue([]);
  api.borrow.mockResolvedValue({});
  api.getStudentIncidents.mockResolvedValue({ damagedCount: 2, lostCount: 1, lastIncidentAt: '2026-09-10', items: [{ borrowingId: 'b9', kind: 'damaged', occurredAt: '2026-09-10', bookTitle: 'Old book', qrCode: 'B9', returnNotes: null, fines: [] }] });
  api.searchBookCopies.mockResolvedValue([]);
});

const typeAndEnter = (label: string, value: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

describe('ScanPage (two-panel desk)', () => {
  it('scans a reader, then several books, and borrows them all with one press', async () => {
    api.scan.mockImplementation(async (code: string) => {
      if (code === 'R000001') return READER;
      if (code === 'B1') return bookCopy('1', 'Dune');
      return bookCopy('2', 'Emma');
    });
    render(<MemoryRouter><ScanPage /></MemoryRouter>);

    typeAndEnter('Scan or type reader code', 'R000001');
    await screen.findByText('Layla');
    typeAndEnter('Scan or type book code', 'B1');
    await screen.findByText('Dune');
    typeAndEnter('Scan or type book code', 'B2');
    await screen.findByText('Emma');

    fireEvent.click(screen.getByRole('button', { name: 'Borrow 2 book(s)' }));
    // The confirm dialog repeats the same label on its own button.
    const confirm = await screen.findAllByRole('button', { name: 'Borrow 2 book(s)' });
    fireEvent.click(confirm[confirm.length - 1]);

    await waitFor(() => expect(api.borrow).toHaveBeenCalledTimes(2));
    expect(api.borrow.mock.calls.map((c) => [c[0], c[1]])).toEqual([['r1', '1'], ['r1', '2']]);
  });

  it('books can be scanned before the reader; borrowing waits for a reader', async () => {
    api.scan.mockImplementation(async (code: string) => (code === 'B1' ? bookCopy('1', 'Dune') : READER));
    render(<MemoryRouter><ScanPage /></MemoryRouter>);

    typeAndEnter('Scan or type book code', 'B1');
    await screen.findByText('Dune');
    expect(screen.getByRole('button', { name: 'Select a reader to borrow' })).toBeDisabled();

    typeAndEnter('Scan or type reader code', 'R000001');
    await screen.findByText('Layla');
    expect(screen.getByRole('button', { name: 'Borrow 1 book(s)' })).toBeEnabled();
  });

  it('scanning the same book twice, or an unavailable copy, explains instead of adding', async () => {
    api.scan
      .mockResolvedValueOnce(bookCopy('1', 'Dune'))
      .mockResolvedValueOnce(bookCopy('1', 'Dune'))
      .mockResolvedValueOnce({ ...bookCopy('3', 'Lost one'), copy: { id: '3', bookId: 'bk', qrCode: 'B3', status: 'lost' } });
    render(<MemoryRouter><ScanPage /></MemoryRouter>);

    typeAndEnter('Scan or type book code', 'B1');
    await screen.findByText('Dune');
    typeAndEnter('Scan or type book code', 'B1');
    await screen.findByText('This book is already in the list.');
    typeAndEnter('Scan or type book code', 'B3');
    await screen.findByText("This copy can't be borrowed — status: lost.");
    expect(screen.queryByText('Lost one')).not.toBeInTheDocument();
  });

  it('a book still on loan to the loaded reader opens its Return form', async () => {
    const borrowing = { id: 'br1', bookCopyId: '9', studentId: 'r1', status: 'active', borrowedAt: '2026-01-01', dueAt: '2026-01-15', returnedAt: null, borrowedBy: 's', returnedBy: null };
    api.scan.mockImplementation(async (code: string) => (code === 'R000001' ? READER : bookCopy('9', 'Out book', { activeBorrowing: borrowing })));
    api.listFineTypes.mockResolvedValue([]);
    render(<MemoryRouter><ScanPage /></MemoryRouter>);

    typeAndEnter('Scan or type reader code', 'R000001');
    await screen.findByText('Layla');
    typeAndEnter('Scan or type book code', 'B9');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(api.borrow).not.toHaveBeenCalled();
  });

  it('keeps a book that failed to borrow in the list, with the reason', async () => {
    api.scan.mockImplementation(async (code: string) => (code === 'R000001' ? READER : bookCopy('1', 'Dune')));
    api.borrow.mockRejectedValue(Object.assign(new Error('Limit reached'), { isAxiosError: true, response: { data: { message: 'Limit reached' } } }));
    render(<MemoryRouter><ScanPage /></MemoryRouter>);

    typeAndEnter('Scan or type reader code', 'R000001');
    await screen.findByText('Layla');
    typeAndEnter('Scan or type book code', 'B1');
    await screen.findByText('Dune');
    fireEvent.click(screen.getByRole('button', { name: 'Borrow 1 book(s)' }));
    const confirm = await screen.findAllByRole('button', { name: 'Borrow 1 book(s)' });
    fireEvent.click(confirm[confirm.length - 1]);

    await screen.findByText(/Borrowed 0 of 1 books/);
    // Still listed (the closing dialog may briefly repeat the title, hence getAll).
    expect(screen.getAllByText('Dune').length).toBeGreaterThan(0);
    expect(api.borrow).toHaveBeenCalledTimes(1);
  });

  it('shows the reader\'s damaged / lost counts', async () => {
    api.scan.mockResolvedValue(READER);
    render(<MemoryRouter><ScanPage /></MemoryRouter>);
    typeAndEnter('Scan or type reader code', 'R000001');
    await screen.findByText('Damaged: 2');
    expect(screen.getByText('Lost: 1')).toBeInTheDocument();
  });

  it('picking a book from the title search adds that copy like a scan would', async () => {
    api.searchBookCopies.mockResolvedValue([{ copyId: '1', bookId: 'bk-1', qrCode: 'B1', status: 'available', title: 'Dune', author: 'Herbert' }]);
    api.scan.mockResolvedValue(bookCopy('1', 'Dune'));
    render(<MemoryRouter><ScanPage /></MemoryRouter>);

    const box = screen.getByLabelText('Or find a book by title, author or code');
    // A real user focuses the field first; MUI only resets the text of an UNfocused autocomplete.
    box.focus();
    fireEvent.change(box, { target: { value: 'dun' } });
    fireEvent.click(await screen.findByText('Herbert · B1 · Available'));

    await waitFor(() => expect(api.scan).toHaveBeenCalledWith('B1'));
    expect(await screen.findByRole('button', { name: 'Select a reader to borrow' })).toBeDisabled();
  });

  it('links the reader\'s name to their page (new tab, so the desk state is kept)', async () => {
    api.scan.mockResolvedValue(READER);
    render(<MemoryRouter><ScanPage /></MemoryRouter>);
    typeAndEnter('Scan or type reader code', 'R000001');
    const link = await screen.findByRole('link', { name: 'Layla' });
    expect(link).toHaveAttribute('href', '/library-circulation/readers/r1');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('folds and unfolds the reader\'s sections, remembering the choice', async () => {
    api.scan.mockResolvedValue(READER);
    const { unmount } = render(<MemoryRouter><ScanPage /></MemoryRouter>);
    typeAndEnter('Scan or type reader code', 'R000001');

    // History starts folded (nothing urgent); the counts stay visible in its header.
    const history = await screen.findByRole('button', { name: /Damage & loss history/ });
    expect(history).toHaveAttribute('aria-expanded', 'false');
    expect(history).toHaveTextContent('Damaged: 2');

    fireEvent.click(history);
    expect(history).toHaveAttribute('aria-expanded', 'true');
    unmount();

    // Next visit: the librarian's own choice wins over the default.
    render(<MemoryRouter><ScanPage /></MemoryRouter>);
    typeAndEnter('Scan or type reader code', 'R000001');
    expect(await screen.findByRole('button', { name: /Damage & loss history/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens the fines section by default only when the reader owes something', async () => {
    api.scan.mockResolvedValue(READER);
    api.listFines.mockResolvedValue({ fines: [{ id: 'f1', fineNumber: 'FINE-1', amount: '5.00', status: 'unpaid', createdAt: '2026-01-01', fineTypeName: 'Late' }] });
    render(<MemoryRouter><ScanPage /></MemoryRouter>);
    typeAndEnter('Scan or type reader code', 'R000001');
    expect(await screen.findByRole('button', { name: /Open fines/ })).toHaveAttribute('aria-expanded', 'true');
  });
});
