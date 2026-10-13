import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import circulationEn from '../../locales/en.json';

const api = vi.hoisted(() => ({ getDashboardStats: vi.fn(), getOverdueBorrowings: vi.fn() }));

vi.mock('../../frontend/api', async (importOriginal) => ({ ...(await importOriginal<object>()), libraryCirculationApi: api }));
vi.mock('../../../../apps/web/src/app/LanguageContext', () => ({ useLanguage: () => ({ language: 'en', direction: 'ltr' }) }));
vi.mock('../../frontend/pages/ReaderLink', () => ({ ReaderLink: ({ name }: { name: string | null }) => <span>{name}</span> }));

import { DashboardPage } from '../../frontend/pages/DashboardPage';

const row = (n: number) => ({
  id: `b${n}`, bookTitle: `Book ${n}`, qrCode: `B${n}`, studentId: `s${n}`, studentCode: `R${n}`, studentName: `Reader ${n}`,
  borrowedAt: '2026-01-01T00:00:00Z', dueAt: '2026-01-15T00:00:00Z', returnedAt: null, status: 'active', daysOverdue: 100 - n,
});

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', circulationEn, true, true);
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getDashboardStats.mockResolvedValue({
    students: 1, totalCopies: 1, availableCopies: 1, borrowedCopies: 0, overdueBorrowings: 25, unpaidFinesTotal: 0, paidFinesTotal: 0,
  });
  // 25 overdue loans; the fake server honours page/pageSize like the real one.
  api.getOverdueBorrowings.mockImplementation(async (q: { page: number; pageSize: number }) => ({
    items: Array.from({ length: Math.max(0, Math.min(q.pageSize, 25 - (q.page - 1) * q.pageSize)) }, (_, i) => row((q.page - 1) * q.pageSize + i + 1)),
    total: 25, page: q.page, pageSize: q.pageSize,
  }));
});

const lastQuery = () => api.getOverdueBorrowings.mock.calls.at(-1)![0] as Record<string, unknown>;

describe('Dashboard overdue-books table', () => {
  it('loads page 1, most overdue first, with the requested columns', async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await screen.findByText('Reader 1');
    expect(lastQuery()).toMatchObject({ page: 1, pageSize: 10, sortBy: 'daysOverdue', sortDir: 'desc' });
    expect(screen.getByText('Book 1')).toBeInTheDocument();
    expect(screen.getByText('Overdue by (days)')).toBeInTheDocument();
    expect(screen.getByText('1–10 of 25')).toBeInTheDocument();
  });

  it('next page requests page 2', async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await screen.findByText('Reader 1');
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await screen.findByText('Reader 11');
    expect(lastQuery()).toMatchObject({ page: 2 });
  });

  it('clicking a column sorts by it (ascending first, then toggles) and returns to page 1', async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await screen.findByText('Reader 1');
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await screen.findByText('Reader 11');

    fireEvent.click(screen.getByText('Book'));
    await waitFor(() => expect(lastQuery()).toMatchObject({ sortBy: 'bookTitle', sortDir: 'asc', page: 1 }));
    fireEvent.click(screen.getByText('Book'));
    await waitFor(() => expect(lastQuery()).toMatchObject({ sortBy: 'bookTitle', sortDir: 'desc' }));
  });

  it('shows an empty message when nothing is overdue', async () => {
    api.getOverdueBorrowings.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await screen.findByText('No overdue books.');
  });
});
