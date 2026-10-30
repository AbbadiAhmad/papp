import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import catalogEn from '../../locales/en.json';

const api = vi.hoisted(() => ({ importBooksPreview: vi.fn(), importBooksCommit: vi.fn() }));
vi.mock('../../frontend/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../frontend/api')>();
  return { ...original, libraryCatalogApi: { ...api } };
});
vi.mock('../../../../apps/web/src/shared/permissions', () => ({
  Can: ({ children }: { children: unknown }) => children,
  useGatedCall: () => (_code: string, fn: () => unknown) => fn(),
}));

import { BooksImportDialog } from '../../frontend/pages/BooksImportDialog';

const field = (name: string, current: string | null, incoming: string | null, extra = {}) => ({ field: name, current, incoming, differs: current !== incoming, locked: false, ...extra });
const report = {
  errorCount: 1,
  warningCount: 1,
  books: [
    {
      key: 'b1', rows: [2, 3], action: 'update', bookId: 'id1', title: 'Alpha',
      fields: [field('title', 'Alpha', 'Alpha 2'), field('author', 'A', 'A')],
      issues: [{ level: 'warning', message: 'author differs between rows 2, 3' }],
      copies: [
        { key: 'b1c1', rows: [2], action: 'update', copyId: 'c1', code: 'B000001', fields: [field('copy_location', 'Shelf 1', 'Shelf 9')], issues: [] },
        { key: 'b1c2', rows: [3], action: 'error', copyId: null, code: 'B000003', fields: [], issues: [{ level: 'error', message: 'code "B000003" is already used by "Beta"' }] },
      ],
    },
  ],
};

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', catalogEn, true, true);
  await i18n.changeLanguage('en');
});
beforeEach(() => {
  vi.clearAllMocks();
  api.importBooksPreview.mockResolvedValue(report);
  api.importBooksCommit.mockResolvedValue({ ...report, result: { booksCreated: 0, booksUpdated: 1, copiesCreated: 0, copiesUpdated: 1, skipped: 0 } });
});

describe('BooksImportDialog', () => {
  it('shows current vs new per book, groups copies under it, flags inconsistencies, and sends the user\'s decisions', async () => {
    render(<BooksImportDialog open onClose={vi.fn()} onImported={vi.fn()} />);
    fireEvent.change(screen.getByTestId('books-import-input'), { target: { files: [new File(['x'], 'books.xlsx')] } });

    expect(await screen.findByText('author differs between rows 2, 3')).toBeInTheDocument();
    expect(screen.getByText('code "B000003" is already used by "Beta"')).toBeInTheDocument();
    // The copy with the error cannot be ticked.
    expect(screen.getByLabelText('Import B000003')).toBeDisabled();

    // Edit the proposed title instead of taking the file's value, and decline the copy's location change.
    fireEvent.change(screen.getByLabelText('New value of Title'), { target: { value: 'Alpha (edited)' } });
    fireEvent.click(screen.getByLabelText('Update Location'));

    fireEvent.click(screen.getByRole('button', { name: /Import 2 items/ }));
    await waitFor(() => expect(api.importBooksCommit).toHaveBeenCalled());
    const [, decisions] = api.importBooksCommit.mock.calls[0];
    expect(decisions.books.b1.apply).toBe(true);
    expect(decisions.books.b1.fields).toEqual({ title: 'Alpha (edited)' });
    expect(decisions.books.b1.copies.b1c1).toEqual({ apply: true, fields: {} });
    expect(decisions.books.b1.copies.b1c2.apply).toBe(false);
    expect(await screen.findByText(/Done: books 0 added, 1 updated/)).toBeInTheDocument();
  });
});
