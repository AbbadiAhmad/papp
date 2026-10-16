import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import catalogEn from '../../locales/en.json';

const api = vi.hoisted(() => ({ uploadBookFile: vi.fn(), deleteBookFile: vi.fn(), downloadBookFile: vi.fn() }));
const download = vi.hoisted(() => vi.fn());
let failNextUpload: Error | null = null;

vi.mock('../../frontend/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../frontend/api')>();
  return {
    ...original,
    downloadBlob: (...args: unknown[]) => download(...args),
    libraryCatalogApi: {
      ...api,
      // A plain function: this Vitest version reports a rejecting spy's promise as an unhandled error.
      uploadBookFile: async (...args: unknown[]) => {
        if (failNextUpload) {
          const error = failNextUpload;
          failNextUpload = null;
          throw error;
        }
        return api.uploadBookFile(...args);
      },
    },
  };
});
vi.mock('../../../../apps/web/src/app/LanguageContext', () => ({ useLanguage: () => ({ language: 'en', direction: 'ltr' }) }));
vi.mock('../../../../apps/web/src/shared/permissions', () => ({
  Can: ({ children }: { children: unknown }) => children,
  useGatedCall: () => (_code: string, fn: () => unknown) => fn(),
}));

import { BookFilesPanel } from '../../frontend/pages/BookFilesPanel';

const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });
const withFiles = { cover: { ext: 'png', sizeBytes: 2 * 1024 * 1024, updatedAt: '2026-01-01' }, book: { ext: 'pdf', sizeBytes: 5 * 1024 * 1024, updatedAt: '2026-01-01' } };

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', catalogEn, true, true);
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
  failNextUpload = null;
  api.uploadBookFile.mockResolvedValue({});
  api.deleteBookFile.mockResolvedValue(undefined);
});

describe('BookFilesPanel', () => {
  it('shows what is stored (type and size) or "None"', () => {
    render(<BookFilesPanel bookId="b1" files={{ cover: null, book: withFiles.book }} onChanged={vi.fn()} />);
    expect(screen.getByText('None')).toBeInTheDocument();
    expect(screen.getByText('PDF · 5 MB')).toBeInTheDocument();
  });

  it('uploads a chosen cover and tells the page to reload', async () => {
    const onChanged = vi.fn();
    render(<BookFilesPanel bookId="b1" files={{ cover: null, book: null }} onChanged={onChanged} />);
    fireEvent.change(screen.getByTestId('cover-input'), { target: { files: [file('c.png', 'image/png')] } });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.uploadBookFile).toHaveBeenCalledWith('b1', 'cover', expect.any(File));
  });

  it('does not send a cover over 5 MB or a book over 30 MB', async () => {
    render(<BookFilesPanel bookId="b1" files={{ cover: null, book: null }} onChanged={vi.fn()} />);
    fireEvent.change(screen.getByTestId('cover-input'), { target: { files: [file('big.png', 'image/png', 6 * 1024 * 1024)] } });
    expect(await screen.findByText('The cover is larger than 5 MB. Choose a smaller picture.')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('book-input'), { target: { files: [file('big.pdf', 'application/pdf', 31 * 1024 * 1024)] } });
    expect(await screen.findByText('The file is larger than 30 MB.')).toBeInTheDocument();
    expect(api.uploadBookFile).not.toHaveBeenCalled();
  });

  it('explains a proxy 413 in plain words', async () => {
    failNextUpload = Object.assign(new Error('Request failed with status code 413'), { isAxiosError: true, response: { status: 413, data: '<html>' } });
    render(<BookFilesPanel bookId="b1" files={{ cover: null, book: null }} onChanged={vi.fn()} />);
    fireEvent.change(screen.getByTestId('book-input'), { target: { files: [file('b.pdf', 'application/pdf')] } });
    expect(await screen.findByText(/ask your administrator to raise the request size limit/)).toBeInTheDocument();
  });

  it('downloads the book under the name the server chose', async () => {
    const blob = new Blob(['x']);
    api.downloadBookFile.mockResolvedValue({ blob, filename: 'Dune.pdf' });
    render(<BookFilesPanel bookId="b1" files={withFiles} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(blob, 'Dune.pdf'));
  });

  it('removes a file only after confirming', async () => {
    const onChanged = vi.fn();
    render(<BookFilesPanel bookId="b1" files={withFiles} onChanged={onChanged} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(api.deleteBookFile).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove', hidden: false }).then(() => screen.getAllByRole('button', { name: 'Remove' }).at(-1)!));
    await waitFor(() => expect(api.deleteBookFile).toHaveBeenCalledWith('b1', 'cover'));
    expect(onChanged).toHaveBeenCalled();
  });
});
