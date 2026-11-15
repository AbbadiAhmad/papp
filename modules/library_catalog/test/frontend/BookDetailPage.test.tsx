import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import coreEn from '../../../../apps/api/src/core/i18n/locales/en.json';
import catalogEn from '../../locales/en.json';

const state = vi.hoisted(() => ({ allowed: new Set<string>() }));
const api = vi.hoisted(() => ({ getBook: vi.fn(), updateBook: vi.fn(), removeBook: vi.fn() }));

vi.mock('../../frontend/api', async (importOriginal) => ({ ...(await importOriginal<object>()), libraryCatalogApi: api }));
vi.mock('../../../../apps/web/src/shared/api/modules', () => ({ modulesApi: { getFrontendManifest: vi.fn(async () => []) } }));
vi.mock('../../../../apps/web/src/app/LanguageContext', () => ({ useLanguage: () => ({ language: 'en', direction: 'ltr' }) }));
vi.mock('../../../../apps/web/src/shared/permissions', () => ({
  Can: ({ permission, children }: { permission: string; children: unknown }) => (state.allowed.has(permission) ? children : null),
  useGatedCall: () => (_code: string, fn: () => unknown) => fn(),
  usePermission: (code: string) => state.allowed.has(code),
  useHasPermission: () => (code: string) => state.allowed.has(code),
}));

import { BookDetailPage } from '../../frontend/pages/BookDetailPage';

const BOOK = {
  id: 'bk1',
  title: 'Dune',
  author: 'Herbert',
  category: 'sf',
  publisher: null,
  readingLevel: null,
  language: null,
  description: null,
  createdAt: '2026-01-01',
  copies: [],
  files: { cover: null, book: null, images: [] },
  averageRating: null,
  ratingsCount: 0,
  ratings: [],
  myRating: null,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/library/books/bk1']}>
      <Routes>
        <Route path="/library/books" element={<div>CATALOG PAGE</div>} />
        <Route path="/library/books/:bookId" element={<BookDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', coreEn, true, true);
  i18n.addResourceBundle('en', 'translation', catalogEn, true, true);
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  state.allowed = new Set(['library_catalog.books.view', 'library_catalog.books.create', 'library_catalog.books.update', 'library_catalog.books.delete']);
  api.getBook.mockResolvedValue(BOOK);
});

describe('book page actions (LIBRARY_CATALOG-D43)', () => {
  it('offers Add copy, Edit and Delete next to the title, like the catalog card', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Dune' });
    expect(screen.getByRole('button', { name: 'Add copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('keeps Edit and Delete as visible buttons on a phone-sized screen (no hidden menu)', async () => {
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, onchange: null, dispatchEvent: () => false })) as never;
    try {
      renderPage();
      await screen.findByRole('heading', { name: 'Dune' });
      expect(screen.getByRole('button', { name: 'Edit' })).toBeVisible();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull();
    } finally {
      // @ts-expect-error restore jsdom's lack of matchMedia
      delete window.matchMedia;
    }
  });

  it('shows only the actions the user may use', async () => {
    state.allowed = new Set(['library_catalog.books.view', 'library_catalog.books.update']);
    renderPage();
    await screen.findByRole('heading', { name: 'Dune' });
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add copy' })).toBeNull();
  });

  it('Edit opens the book form with the current values and saves through updateBook', async () => {
    api.updateBook.mockResolvedValue({});
    renderPage();
    await screen.findByRole('heading', { name: 'Dune' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const title = await screen.findByLabelText(/Title/);
    expect((title as HTMLInputElement).value).toBe('Dune');
    fireEvent.change(title, { target: { value: 'Dune Messiah' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateBook).toHaveBeenCalledWith('bk1', expect.objectContaining({ title: 'Dune Messiah' })));
    await waitFor(() => expect(api.getBook.mock.calls.length).toBeGreaterThan(1)); // the page reloads
  });

  it('Delete asks first, then removes the book and returns to the catalog', async () => {
    api.removeBook.mockResolvedValue(undefined);
    renderPage();
    await screen.findByRole('heading', { name: 'Dune' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.removeBook).not.toHaveBeenCalled();
    expect(await screen.findByText(/Delete "Dune"\?/)).toBeInTheDocument();
    const confirm = screen.getAllByRole('button', { name: 'Delete' }).at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() => expect(api.removeBook).toHaveBeenCalledWith('bk1'));
    expect(await screen.findByText('CATALOG PAGE')).toBeInTheDocument();
  });

  it('a refused delete (the book still has copies) stays on the page and shows the reason', async () => {
    api.removeBook.mockRejectedValue(Object.assign(new Error('still has 2 copies'), { isAxiosError: true, response: { status: 409, data: { message: 'Book "bk1" still has 2 registered copy/copies' } } }));
    renderPage();
    await screen.findByRole('heading', { name: 'Dune' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!);
    expect(await screen.findByText(/still has 2 registered copy/)).toBeInTheDocument();
    expect(screen.queryByText('CATALOG PAGE')).toBeNull();
  });
});
