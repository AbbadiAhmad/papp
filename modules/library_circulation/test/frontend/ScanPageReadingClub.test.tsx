import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import circulationEn from '../../locales/en.json';

const api = vi.hoisted(() => ({
  scan: vi.fn(), getLoanPolicy: vi.fn(), getActiveBorrowingsForStudent: vi.fn(), listFines: vi.fn(), getCopyCirculationHistory: vi.fn(),
  getStudent: vi.fn(), searchStudents: vi.fn(), listFineTypes: vi.fn(), getStudentIncidents: vi.fn(), searchBookCopies: vi.fn(),
}));
const club = vi.hoisted(() => ({ getPendingRewards: vi.fn(), confirmReward: vi.fn(), getReaderOverview: vi.fn(), completeStage: vi.fn(), listBookEntries: vi.fn() }));

vi.mock('../../frontend/api', () => ({ libraryCirculationApi: api }));
vi.mock('../../frontend/readingClubIntegration', () => ({ readingClubIntegration: club }));
vi.mock('../../../../apps/web/src/app/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', mustChangePassword: false, hasPermission: () => true }),
}));
vi.mock('../../../../apps/web/src/app/LanguageContext', () => ({ useLanguage: () => ({ language: 'en', direction: 'ltr' }) }));
vi.mock('../../../../apps/web/src/shared/modules/useInstalledModules', () => ({ useModuleFrontendManifests: () => [{ key: 'reading_club' }] }));
vi.mock('../../../../apps/web/src/shared/permissions', () => ({
  Can: ({ children }: { children: unknown }) => children,
  useGatedCall: () => (_code: string, fn: () => unknown) => fn(),
}));
vi.mock('../../frontend/pages/CameraScanDialog', () => ({ CameraScanDialog: () => null }));
vi.mock('../../frontend/pages/CopyHistoryDialog', () => ({ CopyHistoryDialog: () => null }));
vi.mock('../../frontend/pages/ReaderHistoryDialog', () => ({ ReaderHistoryDialog: () => null }));

import { ScanPage } from '../../frontend/pages/ScanPage';

const READER = { type: 'student', student: { id: 'r1', code: 'R000001', name: 'Layla', className: '5A' }, activeBorrowingsCount: 0 };
const stages = [
  { id: 's1', stageOrder: 1, name: 'Bronze', targetType: 'books', targetAmount: 3 },
  { id: 's2', stageOrder: 2, name: 'Silver', targetType: 'books', targetAmount: 5 },
];
const overview = (over: object = {}) => ({
  membership: { groupId: 'g1', groupName: 'Readers', currentStageId: 's1', stageName: 'Bronze' },
  group: { id: 'g1', name: 'Readers' },
  stage: stages[0],
  progress: { targetType: 'books', targetAmount: 3, progressAmount: 3, isComplete: true },
  groupStages: stages,
  completions: [],
  ...over,
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
  api.getStudentIncidents.mockResolvedValue({ damagedCount: 0, lostCount: 0, lastIncidentAt: null, items: [] });
  api.searchBookCopies.mockResolvedValue([]);
  api.scan.mockResolvedValue(READER);
  club.getPendingRewards.mockResolvedValue([]);
  club.listBookEntries.mockResolvedValue([{ id: 'e1', bookTitle: 'Moby', pageCount: 120, status: 'active', category: 'Fiction', readingLevel: 'L3' }]);
});

async function scanReader() {
  render(<MemoryRouter><ScanPage /></MemoryRouter>);
  const input = screen.getByLabelText('Scan or type reader code');
  fireEvent.change(input, { target: { value: 'R000001' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await screen.findByText('Layla');
}

describe('ScanPage Reading Club panel', () => {
  it('shows group, current stage progress and upcoming stages for the scanned reader', async () => {
    club.getReaderOverview.mockResolvedValue(overview());
    await scanReader();
    await screen.findByText('Reading Club — Readers');
    expect(screen.getByText('Current stage: Bronze (3 / 3 books)')).toBeInTheDocument();
    expect(screen.getByText('Upcoming stages: Silver')).toBeInTheDocument();
    expect(club.getReaderOverview).toHaveBeenCalledWith('r1');
  });

  it('confirming the stage completes it and refreshes the panel', async () => {
    club.getReaderOverview
      .mockResolvedValueOnce(overview())
      .mockResolvedValue(overview({ stage: stages[1], progress: { targetType: 'books', targetAmount: 5, progressAmount: 0, isComplete: false }, completions: [{ id: 'c1', stageName: 'Bronze', stageOrder: 1, completedAt: '', rewardStatus: 'pending' }] }));
    club.completeStage.mockResolvedValue({});
    await scanReader();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm stage complete & move to next' }));
    // The confirm popup lists the stage's books with category, pages and level before completing.
    await screen.findByText('Moby');
    expect(screen.getByText('Fiction')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('L3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm stage finished' }));
    await waitFor(() => expect(club.completeStage).toHaveBeenCalledWith('r1'));
    await screen.findByText('Current stage: Silver (0 / 5 books)');
    expect(screen.getByText('Completed stages: Bronze')).toBeInTheDocument();
  });

  it('completing the last stage tells the librarian the reader finished ALL stages', async () => {
    club.getReaderOverview
      .mockResolvedValueOnce(overview({ stage: stages[1], progress: { targetType: 'books', targetAmount: 5, progressAmount: 5, isComplete: true } }))
      .mockResolvedValue(overview({ stage: null, progress: null, completions: [{ id: 'c2', stageName: 'Silver', stageOrder: 2, completedAt: '', rewardStatus: 'pending' }] }));
    club.completeStage.mockResolvedValue({});
    await scanReader();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm stage complete & move to next' }));
    // The confirm popup lists the stage's books with category, pages and level before completing.
    await screen.findByText('Moby');
    expect(screen.getByText('Fiction')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('L3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm stage finished' }));
    await screen.findByText(/completed ALL stages/);
    await screen.findByText('This reader has completed all stages of the group.');
  });

  it('shows nothing when the reader is not in the club', async () => {
    club.getReaderOverview.mockResolvedValue(overview({ membership: null }));
    await scanReader();
    await waitFor(() => expect(club.getReaderOverview).toHaveBeenCalled());
    expect(screen.queryByText(/Reading Club —/)).not.toBeInTheDocument();
  });
});
