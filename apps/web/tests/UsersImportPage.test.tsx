import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import '../src/app/i18n';
import i18n from '../src/app/i18n';
import { PermissionGateProvider } from '../src/shared/permissions';
import { UsersImportPage } from '../src/core/users/UsersImportPage';
import { usersApi } from '../src/shared/api/users';
import type { ImportReport } from '../src/shared/api/types';

/**
 * D42 (docs/DECISIONS.md) / UsersImportPage.tsx's own docblock: preview
 * NEVER writes, commit RE-VALIDATES FROM SCRATCH and never blindly trusts
 * the client-held preview payload — the UI must mirror that (Commit stays
 * reachable even with preview errors; committing re-sends the file, not the
 * cached preview report).
 */
vi.mock('../src/shared/api/users', () => ({
  usersApi: {
    importPreview: vi.fn(),
    importCommit: vi.fn(),
  },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <PermissionGateProvider>
        <UsersImportPage />
      </PermissionGateProvider>
    </MemoryRouter>,
  );
}

function selectFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error('file input not found');
  fireEvent.change(input, { target: { files: [file] } });
}

function makeFile() {
  return new File(['irrelevant contents'], 'users.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

const validReport: ImportReport = {
  rows: [
    { row: 2, name: 'Jane Doe', email: 'jane@example.com', externalId: null, roleCode: 'reader', department: null, valid: true, error: null, action: 'create', matchedUserId: null },
  ],
  validCount: 1,
  invalidCount: 0,
  allValid: true,
};

const invalidReport: ImportReport = {
  rows: [
    { row: 2, name: 'Jane Doe', email: 'jane@example.com', externalId: null, roleCode: 'reader', department: null, valid: true, error: null, action: 'create', matchedUserId: null },
    { row: 3, name: 'Bad Row', email: 'not-an-email', externalId: null, roleCode: 'reader', department: null, valid: false, error: 'Invalid email address', action: null, matchedUserId: null },
  ],
  validCount: 1,
  invalidCount: 1,
  allValid: false,
};

const mockedImportPreview = vi.mocked(usersApi.importPreview);
const mockedImportCommit = vi.mocked(usersApi.importCommit);

describe('<UsersImportPage /> preview-then-commit wizard', () => {
  beforeEach(() => {
    void i18n.changeLanguage('en');
    mockedImportPreview.mockReset();
    mockedImportCommit.mockReset();
  });

  it('uploading a file triggers the preview call, never the commit call', async () => {
    mockedImportPreview.mockResolvedValue(validReport);
    const { container } = renderPage();
    const file = makeFile();

    selectFile(container, file);

    await waitFor(() => expect(mockedImportPreview).toHaveBeenCalledTimes(1));
    expect(mockedImportPreview).toHaveBeenCalledWith(file);
    expect(mockedImportCommit).not.toHaveBeenCalled();
  });

  it('renders an invalid row\'s error inline and still requires an explicit confirm (no auto-commit / bypass)', async () => {
    mockedImportPreview.mockResolvedValue(invalidReport);
    const { container } = renderPage();
    selectFile(container, makeFile());

    await waitFor(() => expect(screen.getByText('Invalid email address')).toBeInTheDocument());

    // The preview having errors must not silently commit anything...
    expect(mockedImportCommit).not.toHaveBeenCalled();
    // ...and confirming must still be a real, separate, available action —
    // the backend (not a client-side skip) is what ultimately rejects it.
    expect(screen.getByRole('button', { name: 'Confirm import' })).toBeEnabled();
  });

  it('confirming sends the ORIGINAL FILE to commit for re-validation, not the cached preview payload', async () => {
    mockedImportPreview.mockResolvedValue(invalidReport);
    mockedImportCommit.mockResolvedValue({ ...invalidReport, allValid: false });
    const { container } = renderPage();
    const file = makeFile();
    selectFile(container, file);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm import' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));

    await waitFor(() => expect(mockedImportCommit).toHaveBeenCalledTimes(1));
    // Re-validation, not "trust the preview": the commit call receives the
    // same File the browser read, not the ImportReport object from preview.
    const commitArg = mockedImportCommit.mock.calls[0][0];
    expect(commitArg).toBe(file);
    expect(commitArg).not.toBe(invalidReport);
  });

  it('a successful commit shows the committed count and stops offering "confirm" again', async () => {
    mockedImportPreview.mockResolvedValue(validReport);
    mockedImportCommit.mockResolvedValue({ ...validReport });
    const { container } = renderPage();
    selectFile(container, makeFile());

    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm import' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));

    await waitFor(() => expect(screen.getByText('Successfully imported 1 user(s).')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Confirm import' })).not.toBeInTheDocument();
  });
});
