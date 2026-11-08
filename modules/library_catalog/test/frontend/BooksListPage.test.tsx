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
  useHasPermission: () => () => true,
}));

import { BooksListPage } from '../../frontend/pages/BooksListPage';

const book = (extra: Record<string, unknown> = {}) => ({
  id: 'bk1', title: 'Dune', author: 'Herbert', category: 'sf', createdAt: '2026-01-01', totalCopies: 3, availableCopies: 1, ratingsCount: 0,
  copyStatusCounts: { available: 1, damaged: 1, lost: 1 },
  copyCodes: [{ id: 'c0', qrCode: 'B000000', status: 'available' }, { id: 'c1', qrCode: 'B000001', status: 'lost' }, { id: 'c2', qrCode: 'B000002', status: 'damaged' }],
  ...extra,
});

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', catalogEn, true, true);
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  // The copy-code tests below cover the table view; the card view has its own test at the end.
  window.localStorage.setItem('papp:books-view', 'table');
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

  it('shows each book\'s copy codes in the table, each linking to the book at that copy', async () => {
    render(<MemoryRouter><BooksListPage /></MemoryRouter>);
    await screen.findByText('Dune');
    expect(screen.getByRole('link', { name: 'B000000' })).toHaveAttribute('href', '/library/books/bk1?copy=c0');
    expect(screen.getByRole('link', { name: 'B000002' })).toHaveAttribute('href', '/library/books/bk1?copy=c2');
  });

  it('more than four codes collapse to +N', async () => {
    api.listBooks.mockResolvedValue([book({ copyCodes: Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, qrCode: `B00000${i}`, status: 'available' })) })]);
    render(<MemoryRouter><BooksListPage /></MemoryRouter>);
    await screen.findByText('Dune');
    expect(screen.getByRole('link', { name: '+2' })).toHaveAttribute('href', '/library/books/bk1');
    expect(screen.queryByRole('link', { name: 'B000005' })).not.toBeInTheDocument();
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

describe('BooksListPage filter suggestions (LIBRARY_CATALOG-D42)', () => {
  const books = [
    book({ id: 'a', title: 'Alpha', language: 'ar', readingLevel: 'A2', category: 'fiction', author: 'Herbert' }),
    book({ id: 'b', title: 'Beta', language: 'en', readingLevel: 'A1', category: 'science', author: 'Asimov' }),
    book({ id: 'c', title: 'Gamma', language: 'en', readingLevel: 'A2', category: null, author: null }),
  ];
  const optionsOf = () => screen.queryAllByRole('option').map((o) => o.textContent);

  it('opens on focus with the distinct values in use, sorted and without duplicates', async () => {
    api.listBooks.mockResolvedValue(books);
    render(<MemoryRouter><BooksListPage /></MemoryRouter>);
    await screen.findByText('Alpha');
    fireEvent.focus(screen.getByRole('combobox', { name: 'Language' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Language' }), { key: 'ArrowDown' });
    expect(optionsOf()).toEqual(['ar', 'en']);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Language' }), { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Reading level' }), { key: 'ArrowDown' });
    expect(optionsOf()).toEqual(['A1', 'A2']);
  });

  it('narrows while typing, and still sends free text that is not a suggestion', async () => {
    api.listBooks.mockResolvedValue(books);
    render(<MemoryRouter><BooksListPage /></MemoryRouter>);
    await screen.findByText('Alpha');
    const level = screen.getByRole('combobox', { name: 'Reading level' });
    fireEvent.change(level, { target: { value: 'A1' } });
    expect(optionsOf()).toEqual(['A1']);
    fireEvent.change(level, { target: { value: 'B7' } });
    await waitFor(() => expect(api.listBooks.mock.calls.at(-1)![0]).toMatchObject({ readingLevel: 'B7' }));
  });

  it('keeps every suggestion after a filter narrows the list to one language', async () => {
    api.listBooks.mockResolvedValueOnce(books).mockResolvedValue([books[0]]);
    render(<MemoryRouter><BooksListPage /></MemoryRouter>);
    await screen.findByText('Alpha');
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'ar' } });
    await waitFor(() => expect(api.listBooks.mock.calls.at(-1)![0]).toMatchObject({ language: 'ar' }));
    await waitFor(() => expect(screen.queryByText('Beta')).not.toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: '' } });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Language' }), { key: 'ArrowDown' });
    expect(optionsOf()).toEqual(['ar', 'en']);
  });
});

describe('BooksListPage card view', () => {
  it('shows each book as a card linking to its page, with an availability pill, and remembers the choice', async () => {
    window.localStorage.setItem('papp:books-view', 'cards');
    render(<MemoryRouter><BooksListPage /></MemoryRouter>);
    const links = await screen.findAllByRole('link');
    expect(links.some((l) => l.getAttribute('href') === '/library/books/bk1')).toBe(true);
    expect(screen.getByText('Available · 1 / 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(await screen.findByText('Damaged: 1')).toBeInTheDocument();
    expect(window.localStorage.getItem('papp:books-view')).toBe('table');
  });
});
