import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import circulationEn from '../../locales/en.json';

const api = vi.hoisted(() => ({ listStudentsPaged: vi.fn() }));

vi.mock('../../frontend/api', async (importOriginal) => ({ ...(await importOriginal<object>()), libraryCirculationApi: api }));
vi.mock('../../../../apps/web/src/shared/permissions', () => ({
  Can: ({ children }: { children: unknown }) => children,
  useGatedCall: () => (_code: string, fn: () => unknown) => fn(),
}));

import { ReadersListPage } from '../../frontend/pages/ReadersListPage';

const row = (n: number) => ({
  id: `s${n}`, userId: `u${n}`, code: `R${String(n).padStart(6, '0')}`, className: '5A', academicYearId: null,
  createdAt: '', updatedAt: '', name: `Reader ${n}`, email: `r${n}@x.test`, isActive: true, isReader: true, activeBorrowingsCount: n,
});

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', circulationEn, true, true);
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  // 60 matching readers; the fake server honours page/pageSize like the real one.
  api.listStudentsPaged.mockImplementation(async (q: { page: number; pageSize: number }) => ({
    items: Array.from({ length: Math.min(q.pageSize, 60 - (q.page - 1) * q.pageSize) }, (_, i) => row((q.page - 1) * q.pageSize + i + 1)),
    total: 60,
    page: q.page,
    pageSize: q.pageSize,
  }));
});

const lastQuery = () => api.listStudentsPaged.mock.calls.at(-1)![0] as Record<string, unknown>;

describe('ReadersListPage filters + pagination', () => {
  it('loads page 1 with the default page size and shows the total', async () => {
    render(<MemoryRouter><ReadersListPage /></MemoryRouter>);
    await screen.findByText('Reader 1');
    expect(lastQuery()).toMatchObject({ page: 1, pageSize: 25 });
    expect(screen.getByText('1–25 of 60')).toBeInTheDocument();
  });

  it('next page requests page 2 and shows the next slice', async () => {
    render(<MemoryRouter><ReadersListPage /></MemoryRouter>);
    await screen.findByText('Reader 1');
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await screen.findByText('Reader 26');
    expect(lastQuery()).toMatchObject({ page: 2 });
    expect(screen.getByText('26–50 of 60')).toBeInTheDocument();
  });

  it('changing a filter goes back to page 1 and sends the filter to the server', async () => {
    render(<MemoryRouter><ReadersListPage /></MemoryRouter>);
    await screen.findByText('Reader 1');
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await screen.findByText('Reader 26');

    fireEvent.mouseDown(screen.getByLabelText('Status'));
    fireEvent.click(await screen.findByRole('option', { name: 'Inactive' }));

    await waitFor(() => expect(lastQuery()).toMatchObject({ page: 1, status: 'inactive' }));
  });

  it('typing in search is debounced into one request on page 1', async () => {
    render(<MemoryRouter><ReadersListPage /></MemoryRouter>);
    await screen.findByText('Reader 1');
    const before = api.listStudentsPaged.mock.calls.length;
    const box = screen.getByLabelText('Search name, email, code…');
    fireEvent.change(box, { target: { value: 'l' } });
    fireEvent.change(box, { target: { value: 'la' } });
    fireEvent.change(box, { target: { value: 'lay' } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ q: 'lay', page: 1 }));
    // not one request per keystroke
    expect(api.listStudentsPaged.mock.calls.length - before).toBeLessThanOrEqual(2);
  });

  it('rows-per-page change resets to page 1', async () => {
    render(<MemoryRouter><ReadersListPage /></MemoryRouter>);
    await screen.findByText('Reader 1');
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await screen.findByText('Reader 26');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /rows per page/i }));
    fireEvent.click(await screen.findByRole('option', { name: '10' }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ page: 1, pageSize: 10 }));
  });

  it('jumps back to the last real page when the current page no longer exists', async () => {
    render(<MemoryRouter><ReadersListPage /></MemoryRouter>);
    await screen.findByText('Reader 1');
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await screen.findByText('Reader 26');
    // After a delete/filter the server now only has 30 rows: page 2 of 25 still exists, page 3 would not.
    api.listStudentsPaged.mockImplementation(async (q: { page: number; pageSize: number }) => ({
      items: q.page <= 2 ? [row(q.page)] : [], total: 30, page: q.page, pageSize: q.pageSize,
    }));
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ page: 2 }));
  });
});
