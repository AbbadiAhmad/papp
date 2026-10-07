import CameraAltIcon from '@mui/icons-material/CameraAlt';
import CloseIcon from '@mui/icons-material/Close';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import SearchIcon from '@mui/icons-material/Search';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../../apps/web/src/app/AuthContext';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { useModuleFrontendManifests } from '../../../../apps/web/src/shared/modules/useInstalledModules';
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import {
  libraryCirculationApi,
  type ActiveBorrowingForStudent,
  type CopyCirculationHistoryEntry,
  type LibraryBorrowing,
  type LibraryFine,
  type EnrichedFine,
  type LibraryFineType,
  type StudentIncidents,
  type ReturnFineInput,
  type ScanBookCopyResult,
  type ScanStudentResult,
  type StudentSearchResult,
} from '../api';
import { readingClubIntegration, type ReadingClubPendingReward } from '../readingClubIntegration';
import { BookCopyAutocomplete } from './BookCopyAutocomplete';
import { BorrowDialog, type BorrowDialogBook } from './BorrowDialog';
import { CameraScanDialog } from './CameraScanDialog';
import { CopyHistoryDialog } from './CopyHistoryDialog';
import { ExtendLoanDialog } from './ExtendLoanDialog';
import { ReaderAutocomplete } from './ReaderAutocomplete';
import { ReaderHistoryDialog } from './ReaderHistoryDialog';
import { ReturnDialog } from './ReturnDialog';

/** A book the librarian has scanned for borrowing but not yet borrowed. */
interface BasketItem {
  copyId: string;
  bookId: string;
  qrCode: string;
  title: string;
  /** Set when the last "Borrow" attempt for this book failed — the item stays in the list with the reason. */
  error?: string;
}

const toBorrowingAdapter = (b: ActiveBorrowingForStudent, readerId: string): LibraryBorrowing => ({
  id: b.id,
  bookCopyId: b.bookCopyId,
  studentId: readerId,
  status: b.status,
  borrowedAt: b.borrowedAt,
  dueAt: b.dueAt,
  returnedAt: null,
  borrowedBy: '',
  returnedBy: null,
});

/**
 * Two-panel circulation desk. LEFT = the reader (scan their card or find
 * them by name); RIGHT = their books: what they have out (Return / Extend
 * per book) and a "new books" list the librarian fills by scanning several
 * books, then borrows with ONE button. The two inputs are interchangeable —
 * a scanned code is classified by the server (reader / book / unknown) and
 * routed to the right panel, so it doesn't matter which field got the scan.
 * Scanning a book that is already on loan opens its Return form directly.
 * The camera, a USB barcode-scanner keyboard wedge, and typing all work.
 */
export function ScanPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const gated = useGatedCall();
  const { status: authStatus, mustChangePassword, hasPermission } = useAuth();

  const [reader, setReader] = useState<ScanStudentResult | null>(null);
  const [readerCode, setReaderCode] = useState('');
  const [bookCode, setBookCode] = useState('');
  const [basket, setBasket] = useState<BasketItem[]>([]);
  const [priorByCopy, setPriorByCopy] = useState<Record<string, CopyCirculationHistoryEntry | null>>({});
  const [activeBorrowings, setActiveBorrowings] = useState<ActiveBorrowingForStudent[]>([]);
  const [readerFines, setReaderFines] = useState<LibraryFine[]>([]);
  const [allFines, setAllFines] = useState<EnrichedFine[]>([]);
  const [incidents, setIncidents] = useState<StudentIncidents | null>(null);
  const [historyView, setHistoryView] = useState<'incidents' | 'all'>('incidents');
  const [readerSectionsLoading, setReaderSectionsLoading] = useState(false);
  const [pendingRewards, setPendingRewards] = useState<ReadingClubPendingReward[]>([]);
  const [maxBooks, setMaxBooks] = useState<number | null>(null);
  const [loanPeriodDays, setLoanPeriodDays] = useState(14);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [borrowDialogOpen, setBorrowDialogOpen] = useState(false);
  const [returnTarget, setReturnTarget] = useState<{ borrowing: LibraryBorrowing; label: string | null } | null>(null);
  const [extendTarget, setExtendTarget] = useState<LibraryBorrowing | null>(null);
  const [historyCopy, setHistoryCopy] = useState<{ id: string; qrCode: string } | null>(null);
  const [readerHistoryOpen, setReaderHistoryOpen] = useState(false);
  // A scanned book that is on loan to someone OTHER than the loaded reader: offer to return it anyway.
  const [otherLoan, setOtherLoan] = useState<{ borrowing: LibraryBorrowing; label: string; borrowerName: string } | null>(null);
  const [damageFineContext, setDamageFineContext] = useState<{ studentId: string; borrowingId: string; reason: string } | null>(null);

  const bookInputRef = useRef<HTMLInputElement>(null);
  const readerInputRef = useRef<HTMLInputElement>(null);

  // Reading Club hook (optional — only when reading_club is installed and the caller may see it).
  const installedManifests = useModuleFrontendManifests(authStatus === 'authenticated' && !mustChangePassword);
  const readingClubInstalled = installedManifests?.some((m) => m.key === 'reading_club') ?? false;
  const canSeeRewards = readingClubInstalled && hasPermission('reading_club.memberships.view');

  useEffect(() => {
    libraryCirculationApi
      .getLoanPolicy()
      .then((policy) => {
        setMaxBooks(policy.maxBooksPerStudent);
        setLoanPeriodDays(policy.loanPeriodDays);
      })
      .catch(() => undefined); // advisory only — the server enforces the limit on borrow
  }, []);

  const readerId = reader?.student.id ?? null;

  const refreshActive = async (id: string) => {
    try {
      setActiveBorrowings(await libraryCirculationApi.getActiveBorrowingsForStudent(id));
    } catch {
      setActiveBorrowings([]);
    }
  };

  /** Re-reads fines + damage/loss history — after a return (a damaged/lost one adds an incident) or a newly created fine. */
  const refreshFinesAndIncidents = async (id: string) => {
    try {
      const [finesResult, incidentsResult] = await Promise.all([
        libraryCirculationApi.listFines({ studentId: id }),
        libraryCirculationApi.getStudentIncidents(id).catch(() => null),
      ]);
      setAllFines(finesResult.fines);
      setReaderFines(finesResult.fines.filter((f) => f.status === 'unpaid' || f.status === 'partially_paid'));
      setIncidents(incidentsResult);
    } catch {
      /* advisory panels — keep what is shown */
    }
  };

  useEffect(() => {
    if (!readerId) {
      setActiveBorrowings([]);
      setReaderFines([]);
      setAllFines([]);
      setIncidents(null);
      return;
    }
    let cancelled = false;
    setReaderSectionsLoading(true);
    Promise.all([
      libraryCirculationApi.getActiveBorrowingsForStudent(readerId),
      libraryCirculationApi.listFines({ studentId: readerId }),
      libraryCirculationApi.getStudentIncidents(readerId).catch(() => null), // advisory panel — never blocks the desk
    ])
      .then(([borrowings, finesResult, incidentsResult]) => {
        if (cancelled) return;
        setActiveBorrowings(borrowings);
        setAllFines(finesResult.fines);
        setReaderFines(finesResult.fines.filter((f) => f.status === 'unpaid' || f.status === 'partially_paid'));
        setIncidents(incidentsResult);
      })
      .catch(() => {
        if (!cancelled) {
          setActiveBorrowings([]);
          setReaderFines([]);
          setAllFines([]);
          setIncidents(null);
        }
      })
      .finally(() => {
        if (!cancelled) setReaderSectionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [readerId]);

  // §4.4: has THIS reader borrowed each listed copy before? One history lookup per listed book, cached by copy.
  useEffect(() => {
    if (!readerId) return;
    let cancelled = false;
    for (const item of basket) {
      libraryCirculationApi
        .getCopyCirculationHistory(item.copyId, 20)
        .then((history) => {
          if (cancelled) return;
          const prior = history.find((e) => e.studentId === readerId && e.status === 'returned') ?? null;
          setPriorByCopy((current) => ({ ...current, [`${readerId}:${item.copyId}`]: prior }));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [readerId, basket]);

  useEffect(() => {
    if (!canSeeRewards || !readerId) {
      setPendingRewards([]);
      return;
    }
    let cancelled = false;
    readingClubIntegration
      .getPendingRewards(readerId)
      .then((rewards) => {
        if (!cancelled) setPendingRewards(rewards);
      })
      .catch(() => {
        if (!cancelled) setPendingRewards([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canSeeRewards, readerId]);

  const confirmReadingClubReward = async (completionId: string) => {
    try {
      await readingClubIntegration.confirmReward(completionId);
      setPendingRewards((current) => current.filter((r) => r.id !== completionId));
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const clearReader = () => {
    setReader(null);
    setReaderCode('');
    setOtherLoan(null);
    setPendingRewards([]);
    setTimeout(() => readerInputRef.current?.focus(), 0);
  };

  const clearAll = () => {
    clearReader();
    setBasket([]);
    setBookCode('');
    setError(null);
    setMessage(null);
  };

  const focusBookInput = () => setTimeout(() => bookInputRef.current?.focus(), 0);

  /** Loads a reader into the left panel (from a scan result). */
  const adoptReader = (result: ScanStudentResult) => {
    setReader(result);
    setReaderCode('');
    setOtherLoan(null);
    focusBookInput();
  };

  /** Adds a scanned, borrowable copy to the "new books" list (duplicates and unavailable copies are explained, not silently ignored). */
  const addToBasket = (result: ScanBookCopyResult) => {
    if (result.copy.status !== 'available') {
      setError(t('library_circulation.scan.copy_unavailable', { status: result.copy.status }));
      return;
    }
    if (basket.some((item) => item.copyId === result.copy.id)) {
      setError(t('library_circulation.scan.already_in_list'));
      return;
    }
    setBasket((current) => [
      ...current,
      { copyId: result.copy.id, bookId: result.copy.bookId, qrCode: result.copy.qrCode, title: result.book?.title ?? result.copy.qrCode },
    ]);
  };

  const handleBookOnLoan = async (result: ScanBookCopyResult) => {
    const borrowing = result.activeBorrowing!;
    const label = result.book?.title ?? result.copy.qrCode;
    if (reader && borrowing.studentId === reader.student.id) {
      // Their own book — straight to the Return form.
      setReturnTarget({ borrowing, label });
      return;
    }
    const borrower = await libraryCirculationApi.getStudent(borrowing.studentId);
    if (!reader) {
      // No reader loaded yet: scanning a returned book is a normal way to start — load its borrower, then return it.
      const borrowerScan = await libraryCirculationApi.scan(borrower.code);
      if (borrowerScan.type === 'student') adoptReader(borrowerScan);
      setReturnTarget({ borrowing, label });
      return;
    }
    setOtherLoan({ borrowing, label, borrowerName: borrower.name ?? borrower.code });
  };

  /** One entry point for every scanned/typed code: the server classifies it, this routes it to the right panel. */
  const handleCode = async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const result = await libraryCirculationApi.scan(code);
      if (result.type === 'not_found') {
        setError(t('library_circulation.scan.not_found', { code: result.code }));
        return;
      }
      if (result.type === 'student') {
        adoptReader(result);
      } else if (result.activeBorrowing) {
        await handleBookOnLoan(result);
      } else {
        addToBasket(result);
        focusBookInput();
      }
      setReaderCode('');
      setBookCode('');
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleReaderPicked = (picked: StudentSearchResult | null) => {
    if (picked) void handleCode(picked.code);
  };

  const handleCameraDecoded = (decodedText: string) => {
    setCameraOpen(false);
    void handleCode(decodedText);
  };

  // --- borrowing (all listed books in one go) ---------------------------------

  const activeCount = activeBorrowings.length;
  const wouldExceed = maxBooks !== null && activeCount + basket.length > maxBooks;

  const confirmBorrowAll = async (expectedReturnDate?: string, comments?: string) => {
    if (!reader) return;
    setBusy(true);
    setError(null);
    const failed: BasketItem[] = [];
    let done = 0;
    // One request per book, in order: each is validated and audited on its own, and a failure
    // (copy just taken, limit reached…) leaves only that book in the list with its reason.
    for (const item of basket) {
      try {
        await gated('library_circulation.borrow', () => libraryCirculationApi.borrow(reader.student.id, item.copyId, expectedReturnDate, comments));
        done += 1;
      } catch (err) {
        failed.push({ ...item, error: extractErrorMessage(err) });
      }
    }
    setBasket(failed);
    await refreshActive(reader.student.id);
    if (failed.length === 0) {
      setMessage(t('library_circulation.scan.borrow_all_success', { count: done }));
    } else {
      setError(t('library_circulation.scan.borrow_partial', { done, total: done + failed.length }));
    }
    setBusy(false);
    focusBookInput();
  };

  // --- return / extend --------------------------------------------------------

  const openReturnFromList = (b: ActiveBorrowingForStudent) => {
    if (!reader) return;
    setReturnTarget({ borrowing: toBorrowingAdapter(b, reader.student.id), label: b.bookTitle ?? b.qrCode });
  };

  const openExtend = async (borrowing: LibraryBorrowing) => {
    try {
      const policy = await libraryCirculationApi.getLoanPolicy();
      setLoanPeriodDays(policy.loanPeriodDays);
      setExtendTarget(borrowing);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const confirmExtend = async (newDueDate: string) => {
    if (!extendTarget) return;
    setBusy(true);
    setError(null);
    try {
      await gated('library_circulation.extend', () => libraryCirculationApi.extendLoan(extendTarget.id, newDueDate));
      setMessage(t('library_circulation.scan.extend_success'));
      setExtendTarget(null);
      if (reader) await refreshActive(reader.student.id);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmReturn = async (returnStatus: string, returnNotes?: string, returnedAt?: string, fine?: ReturnFineInput) => {
    if (!returnTarget) return;
    setBusy(true);
    setError(null);
    try {
      const result = await gated('library_circulation.return', () =>
        libraryCirculationApi.returnBorrowing(returnTarget.borrowing.id, returnStatus, returnNotes, returnedAt, fine),
      );
      setMessage(
        result.daysLate > 0
          ? t('library_circulation.scan.return_success_late', { days: result.daysLate })
          : t('library_circulation.scan.return_success'),
      );
      // §6.1: damage/loss suggests a fine but never auto-creates one — the librarian confirms it explicitly.
      if (result.damageFine?.suggested) {
        setDamageFineContext({ studentId: result.borrowing.studentId, borrowingId: result.borrowing.id, reason: result.damageFine.reason });
      }
      setReturnTarget(null);
      setOtherLoan(null);
      if (reader) {
        await refreshActive(reader.student.id);
        await refreshFinesAndIncidents(reader.student.id);
      }
      focusBookInput();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const borrowDialogBooks: BorrowDialogBook[] = basket.map((b) => ({ id: b.copyId, title: b.title, qrCode: b.qrCode }));

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('library_circulation.menu.scan')}
      </Typography>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {message ? (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message}
        </Alert>
      ) : null}

      <Grid container spacing={2}>
        {/* ------------------------------ READER ------------------------------ */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                {t('library_circulation.scan.reader_panel_title')}
              </Typography>

              {!reader ? (
                <Stack spacing={2} sx={{ mt: 1 }}>
                  <Stack direction="row" spacing={1}>
                    <TextField
                      autoFocus
                      fullWidth
                      inputRef={readerInputRef}
                      label={t('library_circulation.scan.reader_code_label')}
                      value={readerCode}
                      onChange={(e) => setReaderCode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleCode(readerCode);
                      }}
                      disabled={busy}
                    />
                    <Button variant="contained" startIcon={<SearchIcon />} onClick={() => handleCode(readerCode)} disabled={busy || !readerCode.trim()}>
                      {t('library_circulation.scan.scan_button')}
                    </Button>
                    <Tooltip title={t('library_circulation.scan.camera_button')}>
                      <span>
                        <IconButton onClick={() => setCameraOpen(true)} disabled={busy} aria-label={t('library_circulation.scan.camera_button')}>
                          <CameraAltIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                  <ReaderAutocomplete
                    value={null}
                    onChange={handleReaderPicked}
                    label={t('library_circulation.scan.search_reader_label')}
                    disabled={busy}
                  />
                  <Typography variant="body2" color="text.secondary">
                    {t('library_circulation.scan.no_reader_hint')}
                  </Typography>
                </Stack>
              ) : (
                <Stack spacing={2} sx={{ mt: 1 }}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Typography variant="h5">{reader.student.name ?? reader.student.code}</Typography>
                    <Button size="small" onClick={clearReader} disabled={busy} startIcon={<CloseIcon />}>
                      {t('library_circulation.scan.change_reader')}
                    </Button>
                  </Stack>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                    <Chip label={`${t('library_circulation.students.code')}: ${reader.student.code}`} size="small" variant="outlined" />
                    {reader.student.className ? (
                      <Chip label={`${t('library_circulation.students.class')}: ${reader.student.className}`} size="small" variant="outlined" />
                    ) : null}
                    <Chip
                      size="small"
                      color={wouldExceed ? 'error' : 'primary'}
                      label={
                        maxBooks !== null
                          ? t('library_circulation.scan.borrowed_of_max', { count: activeCount, max: maxBooks })
                          : t('library_circulation.scan.active_borrowings_count', { count: activeCount })
                      }
                    />
                  </Stack>
                  <Button variant="text" size="small" sx={{ alignSelf: 'flex-start' }} onClick={() => setReaderHistoryOpen(true)}>
                    {t('library_circulation.scan.view_borrow_history')}
                  </Button>

                  <Divider />

                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      {t('library_circulation.students.open_fines')}
                    </Typography>
                    {readerSectionsLoading ? (
                      <Typography variant="body2" color="text.secondary">
                        {t('core.common.loading')}
                      </Typography>
                    ) : readerFines.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        {t('library_circulation.scan.no_open_fines')}
                      </Typography>
                    ) : (
                      <List dense disablePadding>
                        {readerFines.map((fine) => (
                          <ListItem key={fine.id} disableGutters>
                            <ListItemText
                              primary={`${fine.fineNumber} — ${fine.amount}`}
                              secondary={t(`library_circulation.fine_status.${fine.status}`)}
                            />
                          </ListItem>
                        ))}
                      </List>
                    )}
                  </Box>

                  <Divider />

                  {/* Past damage / loss: how often, when, and what became of the fine. */}
                  <Box>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
                      <Typography variant="subtitle2">{t('library_circulation.scan.incidents_title')}</Typography>
                      <ToggleButtonGroup size="small" exclusive value={historyView} onChange={(_e, v) => v && setHistoryView(v)}>
                        <ToggleButton value="incidents">{t('library_circulation.scan.incidents_filter_damaged_lost')}</ToggleButton>
                        <ToggleButton value="all">{t('library_circulation.scan.incidents_filter_all')}</ToggleButton>
                      </ToggleButtonGroup>
                    </Stack>
                    {historyView === 'incidents' ? (
                      !incidents || incidents.items.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          {t('library_circulation.scan.incidents_none')}
                        </Typography>
                      ) : (
                        <>
                          <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', gap: 1 }}>
                            <Chip size="small" color="warning" label={t('library_circulation.scan.incidents_damaged_count', { count: incidents.damagedCount })} />
                            <Chip size="small" color="error" label={t('library_circulation.scan.incidents_lost_count', { count: incidents.lostCount })} />
                            {incidents.lastIncidentAt ? (
                              <Chip size="small" variant="outlined" label={t('library_circulation.scan.incidents_last', { date: formatDateOnly(incidents.lastIncidentAt, language) })} />
                            ) : null}
                          </Stack>
                          <List dense disablePadding sx={{ maxHeight: 220, overflowY: 'auto' }}>
                            {incidents.items.map((item) => (
                              <ListItem key={item.borrowingId} disableGutters divider>
                                <ListItemText
                                  primary={`${t(`library_circulation.scan.incident_${item.kind}`)} — ${item.bookTitle ?? item.qrCode ?? '—'}`}
                                  secondary={`${formatDateOnly(item.occurredAt, language)} · ${
                                    item.fines.length === 0
                                      ? t('library_circulation.scan.incident_no_fine')
                                      : item.fines
                                          .map((f) => `${f.fineNumber}: ${f.amount} (${t(`library_circulation.fine_status.${f.status}`)})`)
                                          .join(', ')
                                  }`}
                                />
                              </ListItem>
                            ))}
                          </List>
                        </>
                      )
                    ) : allFines.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        {t('library_circulation.scan.no_fines_at_all')}
                      </Typography>
                    ) : (
                      <List dense disablePadding sx={{ maxHeight: 220, overflowY: 'auto' }}>
                        {allFines.map((fine) => (
                          <ListItem key={fine.id} disableGutters divider>
                            <ListItemText
                              primary={`${fine.fineTypeName ?? ''} — ${fine.amount}`}
                              secondary={`${formatDateOnly(fine.createdAt, language)} · ${fine.fineNumber} · ${t(`library_circulation.fine_status.${fine.status}`)}`}
                            />
                          </ListItem>
                        ))}
                      </List>
                    )}
                  </Box>

                  {pendingRewards.length > 0 ? (
                    <>
                      <Divider />
                      <Box sx={{ p: 1.5, borderRadius: 1, border: '1px solid', borderColor: 'warning.main' }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                          <EmojiEventsIcon color="warning" fontSize="small" />
                          <Typography variant="subtitle2">{t('library_circulation.scan.reading_club_reward_heading')}</Typography>
                        </Stack>
                        <Stack spacing={1.5}>
                          {pendingRewards.map((reward) => (
                            <Box key={reward.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                              <Typography variant="body2">
                                {t('library_circulation.scan.reading_club_reward_line', {
                                  group: reward.groupName ?? '',
                                  stage: reward.stageName ?? '',
                                  reward: reward.rewardDescription ?? t('library_circulation.scan.reading_club_reward_unspecified'),
                                })}
                              </Typography>
                              <Can permission="reading_club.stage_completions.confirm_reward">
                                <Button size="small" variant="contained" color="warning" onClick={() => confirmReadingClubReward(reward.id)}>
                                  {t('library_circulation.scan.reading_club_confirm_reward_button')}
                                </Button>
                              </Can>
                            </Box>
                          ))}
                        </Stack>
                      </Box>
                    </>
                  ) : null}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* ------------------------------- BOOKS ------------------------------ */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                {t('library_circulation.scan.books_panel_title')}
              </Typography>

              <Stack spacing={2} sx={{ mt: 1 }}>
                {/* New books: scan several, borrow them all at once */}
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t('library_circulation.scan.to_borrow_title')}
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <TextField
                      fullWidth
                      inputRef={bookInputRef}
                      label={t('library_circulation.scan.book_code_label')}
                      value={bookCode}
                      onChange={(e) => setBookCode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleCode(bookCode);
                      }}
                      disabled={busy}
                    />
                    <Button variant="outlined" onClick={() => handleCode(bookCode)} disabled={busy || !bookCode.trim()}>
                      {t('library_circulation.scan.add_book_button')}
                    </Button>
                    <Tooltip title={t('library_circulation.scan.camera_button')}>
                      <span>
                        <IconButton onClick={() => setCameraOpen(true)} disabled={busy} aria-label={t('library_circulation.scan.camera_button')}>
                          <CameraAltIcon />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>

                  <Box sx={{ mt: 1.5 }}>
                    <BookCopyAutocomplete onPick={(copy) => void handleCode(copy.qrCode)} disabled={busy} />
                  </Box>

                  {basket.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      {t('library_circulation.scan.to_borrow_empty')}
                    </Typography>
                  ) : (
                    <List dense disablePadding sx={{ mt: 1, maxHeight: 280, overflowY: 'auto' }}>
                      {basket.map((item) => {
                        const prior = readerId ? priorByCopy[`${readerId}:${item.copyId}`] : null;
                        return (
                          <ListItem
                            key={item.copyId}
                            disableGutters
                            divider
                            secondaryAction={
                              <Stack direction="row" spacing={0.5}>
                                <Button size="small" onClick={() => setHistoryCopy({ id: item.copyId, qrCode: item.qrCode })}>
                                  {t('library_circulation.scan.view_copy_history')}
                                </Button>
                                <Tooltip title={t('library_circulation.scan.remove')}>
                                  <IconButton
                                    size="small"
                                    aria-label={t('library_circulation.scan.remove')}
                                    onClick={() => setBasket((current) => current.filter((i) => i.copyId !== item.copyId))}
                                    disabled={busy}
                                  >
                                    <CloseIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </Stack>
                            }
                          >
                            <ListItemText
                              primary={item.title}
                              secondary={
                                item.error ??
                                (prior
                                  ? `${item.qrCode} · ${t('library_circulation.scan.previous_borrow_returned', {
                                      date: formatDateOnly(prior.returnedAt ?? prior.borrowedAt, language),
                                      status: t(`library_circulation.borrowing_status.${prior.status}`, prior.status),
                                    })}`
                                  : item.qrCode)
                              }
                              slotProps={{ secondary: { color: item.error ? 'error' : 'text.secondary' } }}
                              sx={{ pr: 16 }}
                            />
                          </ListItem>
                        );
                      })}
                    </List>
                  )}

                  {wouldExceed && basket.length > 0 ? (
                    <Alert severity="warning" sx={{ mt: 1 }}>
                      {t('library_circulation.scan.limit_exceeded', { max: maxBooks })}
                    </Alert>
                  ) : null}

                  {basket.length > 0 ? (
                    <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                      <Can permission="library_circulation.borrow">
                        <Button
                          variant="contained"
                          size="large"
                          fullWidth
                          onClick={() => setBorrowDialogOpen(true)}
                          disabled={busy || !reader || wouldExceed}
                        >
                          {reader
                            ? t('library_circulation.scan.borrow_all_button', { count: basket.length })
                            : t('library_circulation.scan.borrow_requires_reader')}
                        </Button>
                      </Can>
                      <Button onClick={() => setBasket([])} disabled={busy}>
                        {t('library_circulation.scan.clear_list')}
                      </Button>
                    </Stack>
                  ) : null}
                </Box>

                {otherLoan ? (
                  <Alert
                    severity="warning"
                    action={
                      <Can permission="library_circulation.return">
                        <Button color="inherit" size="small" onClick={() => setReturnTarget({ borrowing: otherLoan.borrowing, label: otherLoan.label })}>
                          {t('library_circulation.scan.return_it')}
                        </Button>
                      </Can>
                    }
                  >
                    {t('library_circulation.scan.on_loan_elsewhere', { book: otherLoan.label, reader: otherLoan.borrowerName })}
                  </Alert>
                ) : null}

                {reader ? <Divider /> : null}

                {/* Currently borrowed by the loaded reader */}
                {reader ? (
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      {t('library_circulation.scan.active_borrowings_title')}
                    </Typography>
                    {readerSectionsLoading ? (
                      <Typography variant="body2" color="text.secondary">
                        {t('core.common.loading')}
                      </Typography>
                    ) : activeBorrowings.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        {t('library_circulation.scan.no_active_borrowings')}
                      </Typography>
                    ) : (
                      <List dense disablePadding sx={{ maxHeight: 360, overflowY: 'auto' }}>
                        {activeBorrowings.map((b) => (
                          <ListItem
                            key={b.id}
                            disableGutters
                            divider
                            secondaryAction={
                              <Stack direction="row" spacing={1}>
                                <Can permission="library_circulation.extend">
                                  <Button size="small" onClick={() => openExtend(toBorrowingAdapter(b, reader.student.id))} disabled={busy}>
                                    {t('library_circulation.borrowings.extend')}
                                  </Button>
                                </Can>
                                <Can permission="library_circulation.return">
                                  <Button size="small" variant="outlined" onClick={() => openReturnFromList(b)} disabled={busy}>
                                    {t('library_circulation.scan.confirm_return')}
                                  </Button>
                                </Can>
                              </Stack>
                            }
                          >
                            <ListItemText
                              primary={b.bookTitle ?? b.qrCode ?? '—'}
                              secondary={`${b.qrCode ?? ''} · ${t('library_circulation.borrowings.due_at')}: ${formatDateOnly(b.dueAt, language)}`}
                              slotProps={{ secondary: { color: b.isOverdue ? 'error' : 'text.secondary' } }}
                              sx={{ pr: 22 }}
                            />
                          </ListItem>
                        ))}
                      </List>
                    )}
                  </Box>
                ) : null}

                {reader || basket.length > 0 ? (
                  <Box>
                    <Button onClick={clearAll} disabled={busy}>
                      {t('library_circulation.scan.done_next_reader')}
                    </Button>
                  </Box>
                ) : null}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <CameraScanDialog open={cameraOpen} onClose={() => setCameraOpen(false)} onDecoded={handleCameraDecoded} />

      <BorrowDialog
        open={borrowDialogOpen}
        readerName={reader ? (reader.student.name ?? reader.student.code) : null}
        readerCode={reader?.student.code ?? null}
        books={borrowDialogBooks}
        loanPeriodDays={loanPeriodDays}
        onBorrow={confirmBorrowAll}
        onClose={() => setBorrowDialogOpen(false)}
        loading={busy}
      />

      <ReturnDialog
        open={returnTarget !== null}
        borrowing={returnTarget?.borrowing ?? null}
        bookLabel={returnTarget?.label ?? null}
        onReturn={confirmReturn}
        onClose={() => setReturnTarget(null)}
        loading={busy}
      />

      <ExtendLoanDialog
        open={extendTarget !== null}
        borrowing={extendTarget}
        loanPeriodDays={loanPeriodDays}
        onExtend={confirmExtend}
        onClose={() => setExtendTarget(null)}
        loading={busy}
      />

      <CopyHistoryDialog
        open={historyCopy !== null}
        copyId={historyCopy?.id ?? null}
        qrCode={historyCopy?.qrCode}
        onClose={() => setHistoryCopy(null)}
      />

      <ReaderHistoryDialog open={readerHistoryOpen} studentId={readerId} onClose={() => setReaderHistoryOpen(false)} />

      <CreateFineDialog
        context={damageFineContext}
        onClose={() => setDamageFineContext(null)}
        onCreated={() => {
          setDamageFineContext(null);
          setMessage(t('library_circulation.scan.fine_created'));
          if (reader) void refreshFinesAndIncidents(reader.student.id);
        }}
      />
    </Box>
  );
}

/** §6.1: [Create Fine] — shown after a damaged/lost return, pre-filled from the matching seeded fine type (FINE-DAMAGE/FINE-LOST), librarian confirms/adjusts the amount before it's actually created. */
function CreateFineDialog({
  context,
  onClose,
  onCreated,
}: {
  context: { studentId: string; borrowingId: string; reason: string } | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [fineTypes, setFineTypes] = useState<LibraryFineType[]>([]);
  const [fineTypeId, setFineTypeId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!context) return;
    libraryCirculationApi.listFineTypes().then((types) => {
      setFineTypes(types);
      const matchingCode = context.reason === 'damaged' ? 'FINE-DAMAGE' : context.reason === 'lost' ? 'FINE-LOST' : undefined;
      const match = types.find((ft) => ft.code === matchingCode) ?? types[0];
      if (match) {
        setFineTypeId(match.id);
        setAmount(match.defaultAmount);
      }
    });
  }, [context]);

  if (!context) return null;

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await gated('library_circulation.fines.record', () =>
        libraryCirculationApi.createFine({
          studentId: context.studentId,
          fineTypeId,
          amount: Number(amount),
          borrowingId: context.borrowingId,
        }),
      );
      onCreated();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={context !== null} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('library_circulation.scan.create_fine_title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          ) : null}
          <TextField
            select
            label={t('library_circulation.fines.fine_type')}
            value={fineTypeId}
            onChange={(e) => setFineTypeId(e.target.value)}
          >
            {fineTypes.map((ft) => (
              <MenuItem key={ft.id} value={ft.id}>
                {ft.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('library_circulation.fines.amount')}
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {t('core.common.cancel')}
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting || !fineTypeId || !amount}>
          {t('library_circulation.scan.create_fine_button')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
