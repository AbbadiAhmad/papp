import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import catalogEn from '../../locales/en.json';

const api = vi.hoisted(() => ({ listBooks: vi.fn() }));

vi.mock('../../frontend/api', async (importOriginal) => ({ ...(await importOriginal<object>()), libraryCatalogApi: api }));
vi.mock('../../../../apps/web/src/app/LanguageContext', () => ({ useLanguage: () => ({ language: 'en', direction: 'ltr' }) }));
vi.mock('../../../../apps/web/src/shared/permissions', () => ({
  Can: ({ children }: { children: unknown }) => children,
  useGatedCall: () => (_code: string, fn: () => unknown) => fn(),
}));

import { BooksListPage } from '../../frontend/pages/BooksListPage';

const book = (extra: Record<string, unknown> = {}) => ({
  id: 'bk1', title: 'Dune', author: 'Herbert', category: 'sf', createdAt: '2026-01-01', totalCopies: 3, availableCopies: 1, ratingsCount: 0,
  copyStatusCounts: { available: 1, damaged: 1, lost: 1 }, ...extra,
});

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', catalogEn, true, true);
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  api.listBooks.mockResolvedValue([book()]);
});

const lastParams = () => api.listBooks.mock.calls.at(-1)![0] as { copyStatus?: string[] };

describe('BooksListPage copy-status filter', () => {
  it('lists all books by default, with the non-available copy counts per book', async () => {
    render(<MemoryRouter><BooksListPage /></MemoryRouter>);
    await screen.findByText('Dune');
    expect(lastParams().copyStatus).toEqual([]);
    expect(screen.getByText('Damaged: 1')).toBeInTheDocument();
    expect(screen.getByText('Lost: 1')).toBeInTheDocument();
  });

  it('the Damaged / lost tab filters by those statuses and shows each matching copy code as a link to the book at that copy', async () => {
    api.listBooks.mockResolvedValue([
      book({ matchingCopies: [{ id: 'c1', qrCode: 'B000001', status: 'lost' }, { id: 'c2', qrCode: 'B000002', status: 'damaged' }] }),
    ]);
    render(<MemoryRouter><BooksListPage /></MemoryRouter>);
    await screen.findByText('Dune');

    fireEvent.click(screen.getByRole('tab', { name: 'Damaged / lost' }));

    await waitFor(() => expect(lastParams().copyStatus).toEqual(['damaged', 'lost']));
    const code = await screen.findByRole('link', { name: 'B000002 · Damaged' });
    expect(code).toHaveAttribute('href', '/library/books/bk1?copy=c2');
    expect(screen.getByRole('tab', { name: 'Damaged / lost' })).toHaveAttribute('aria-selected', 'true');
  });
});
