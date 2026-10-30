import { render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import catalogEn from '../../locales/en.json';

const permission = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock('../../../../apps/web/src/shared/permissions', () => ({
  Can: ({ children }: { children: unknown }) => children,
  useGatedCall: () => (_code: string, fn: () => unknown) => fn(),
  usePermission: (code: string) => permission.allowed.has(code),
}));
vi.mock('../../frontend/api', async (importOriginal) => ({ ...(await importOriginal<object>()), libraryCatalogApi: { peekNextCopyCode: vi.fn(async () => 'B000001') } }));

import { BookFormDialog } from '../../frontend/pages/BookFormDialog';

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', catalogEn, true, true);
  await i18n.changeLanguage('en');
});
beforeEach(() => permission.allowed.clear());

describe('internal note fields (LIBRARY_CATALOG-D35)', () => {
  it('are shown for a user with notes.view: one for the book and one for its first copy', () => {
    permission.allowed.add('library_catalog.notes.view');
    render(<BookFormDialog open book={null} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getAllByLabelText('Internal note')).toHaveLength(2);
  });

  it('are not rendered at all without notes.view', () => {
    render(<BookFormDialog open book={null} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText('Internal note')).toBeNull();
  });
});
