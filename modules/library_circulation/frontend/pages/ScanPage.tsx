import CameraAltIcon from '@mui/icons-material/CameraAlt';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
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
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import {
  libraryCirculationApi,
  type ActiveBorrowingForStudent,
  type CopyCirculationHistoryEntry,
  type LibraryBorrowing,
  type LibraryFine,
  type LibraryFineType,
  type ReturnFineInput,
  type ScanBookCopyResult,
  type ScanStudentResult,
  type StudentSearchResult,
} from '../api';
import { BorrowDialog } from './BorrowDialog';
import { CameraScanDialog } from './CameraScanDialog';
import { CopyHistoryDialog } from './CopyHistoryDialog';
import { ReaderAutocomplete } from './ReaderAutocomplete';
import { ReaderHistoryDialog } from './ReaderHistoryDialog';
import { ReturnDialog } from './ReturnDialog';

/**
 * §6/§30 — "the most important screen" / "Quick Library": one scan input,
 * two slots (student + book copy) filled by successive scans, then a single
 * confirm action. All three of §6's input methods are real here: (1) the
 * camera dialog below (`CameraScanDialog`, `html5-qrcode`), (2) a USB
 * barcode-scanner keyboard-wedge (works for free — those just emit ordinary
 * keystrokes + Enter into the same text field), (3) manual typing as the
 * fallback.
 */
export function ScanPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const gated = useGatedCall();
  const [code, setCode] = useState('');
  const [student, setStudent] = useState<ScanStudentResult | null>(null);
  const [bookCopy, setBookCopy] = useState<ScanBookCopyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [borrowDialogOpen, setBorrowDialogOpen] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [currentBorrowingForReturn, setCurrentBorrowingForReturn] = useState<LibraryBorrowing | null>(null);
  const [returnBookLabel, setReturnBookLabel] = useState<string | null>(null);
  const [returnFromActiveList, setReturnFromActiveList] = useState(false);
  const [loanPeriodDays, setLoanPeriodDays] = useState(14);
  const [copyHistoryOpen, setCopyHistoryOpen] = useState(false);
  const [readerHistoryOpen, setReaderHistoryOpen] = useState(false);
  // §4.4: this reader's own PAST (non-active) borrowing(s) of THIS exact
  // copy — a real history lookup, not just "is it checked out right now"
  // (which bookCopy.activeBorrowing already covers on its own, regardless
  // of who has it). Computed once both slots are filled.
  const [priorBorrowByThisReader, setPriorBorrowByThisReader] = useState<CopyCirculationHistoryEntry | null>(null);
  const [damageFineContext, setDamageFineContext] = useState<{ studentId: string; borrowingId: string; reason: string } | null>(null);
  // Reader-centric sections (in addition to, not replacing, the single-scan
  // borrow/return flow below): once a reader is loaded — by code scan OR by
  // the new search-by-name picker — their currently-active borrowings and
  // open fines are shown directly, independent of whether a book has been
  // scanned yet.
  const [activeBorrowings, setActiveBorrowings] = useState<ActiveBorrowingForStudent[]>([]);
  const [readerFines, setReaderFines] = useState<LibraryFine[]>([]);
  const [readerSectionsLoading, setReaderSectionsLoading] = useState(false);

  useEffect(() => {
    if (!student) {
      setActiveBorrowings([]);
      setReaderFines([]);
      return;
    }
    let cancelled = false;
    setReaderSectionsLoading(true);
    Promise.all([
      libraryCirculationApi.getActiveBorrowingsForStudent(student.student.id),
      libraryCirculationApi.listFines({ studentId: student.student.id }),
    ])
      .then(([borrowings, finesResult]) => {
        if (cancelled) return;
        setActiveBorrowings(borrowings);
        setReaderFines(finesResult.fines.filter((f) => f.status === 'unpaid' || f.status === 'partially_paid'));
      })
      .catch(() => {
        if (!cancelled) {
          setActiveBorrowings([]);
          setReaderFines([]);
        }
      })
      .finally(() => {
        if (!cancelled) setReaderSectionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [student]);

  useEffect(() => {
    if (!student || !bookCopy) {
      setPriorBorrowByThisReader(null);
      return;
    }
    let cancelled = false;
    libraryCirculationApi
      .getCopyCirculationHistory(bookCopy.copy.id, 20)
      .then((history) => {
        if (cancelled) return;
        const priorReturned = history.find((entry) => entry.studentId === student.student.id && entry.status === 'returned');
        setPriorBorrowByThisReader(priorReturned ?? null);
      })
      .catch(() => {
        if (!cancelled) setPriorBorrowByThisReader(null);
      });
    return () => {
      cancelled = true;
    };
  }, [student, bookCopy]);

  const reset = () => {
    setStudent(null);
    setBookCopy(null);
    setCode('');
    setError(null);
    setMessage(null);
  };

  const scanCode = async (rawCode: string) => {
    if (!rawCode.trim()) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const result = await libraryCirculationApi.scan(rawCode.trim());
      if (result.type === 'student') {
        setStudent(result);
      } else {
        setBookCopy(result);
      }
      setCode('');
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleScan = () => scanCode(code);

  /** Reader search-by-name picker: reuses the same scan() lookup by the selected reader's own code, so it fills `student` identically to a real code scan. */
  const handleReaderPicked = (picked: StudentSearchResult | null) => {
    if (picked) void scanCode(picked.code);
  };

  const handleCameraDecoded = (decodedText: string) => {
    setCameraOpen(false);
    void scanCode(decodedText);
  };

  const openBorrowDialog = async () => {
    if (!student || !bookCopy) return;
    try {
      const policy = await libraryCirculationApi.getLoanPolicy();
      setLoanPeriodDays(policy.loanPeriodDays);
      setBorrowDialogOpen(true);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const confirmBorrow = async (expectedReturnDate?: string, comments?: string) => {
    if (!student || !bookCopy) return;
    setBusy(true);
    setError(null);
    try {
      await gated('library_circulation.borrow', () =>
        libraryCirculationApi.borrow(student.student.id, bookCopy.copy.id, expectedReturnDate, comments),
      );
      setMessage(t('library_circulation.scan.borrow_success'));
      reset();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const openReturnDialog = (borrowing: LibraryBorrowing, bookLabel: string | null) => {
    setCurrentBorrowingForReturn(borrowing);
    setReturnBookLabel(bookLabel);
    setReturnDialogOpen(true);
  };

  /** Active-borrowings section's per-row Return button: ReturnDialog only ever reads id/borrowedAt/dueAt off `borrowing`, so a light adapter is enough — no second fetch needed. */
  const openReturnDialogFromActive = (activeBorrowing: ActiveBorrowingForStudent) => {
    setReturnFromActiveList(true);
    openReturnDialog(
      {
        id: activeBorrowing.id,
        bookCopyId: activeBorrowing.bookCopyId,
        studentId: student?.student.id ?? '',
        status: activeBorrowing.status,
        borrowedAt: activeBorrowing.borrowedAt,
        dueAt: activeBorrowing.dueAt,
        returnedAt: null,
        borrowedBy: '',
        returnedBy: null,
      },
      activeBorrowing.bookTitle ?? activeBorrowing.qrCode,
    );
  };

  const confirmReturn = async (returnStatus: string, returnNotes?: string, returnedAt?: string, fine?: ReturnFineInput) => {
    if (!currentBorrowingForReturn) return;
    setBusy(true);
    setError(null);
    try {
      const result = await gated('library_circulation.return', () =>
        libraryCirculationApi.returnBorrowing(currentBorrowingForReturn.id, returnStatus, returnNotes, returnedAt, fine),
      );
      setMessage(
        result.daysLate > 0
          ? t('library_circulation.scan.return_success_late', { days: result.daysLate })
          : t('library_circulation.scan.return_success'),
      );
      // §6.1: damage/loss suggests a fine but never auto-creates one — the
      // librarian confirms amount/type explicitly via this dialog.
      if (result.damageFine?.suggested) {
        setDamageFineContext({ studentId: result.borrowing.studentId, borrowingId: result.borrowing.id, reason: result.damageFine.reason });
      }
      setCurrentBorrowingForReturn(null);
      if (returnFromActiveList && student) {
        // Returned from the reader's own active-borrowings list — keep the
        // reader loaded (they may have more books to return/borrow) and just
        // refresh that list, instead of the full reset() a bookCopy-slot
        // return uses.
        setBookCopy(null);
        setCode('');
        libraryCirculationApi
          .getActiveBorrowingsForStudent(student.student.id)
          .then(setActiveBorrowings)
          .catch(() => setActiveBorrowings([]));
      } else {
        reset();
      }
      setReturnFromActiveList(false);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 960 }}>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('library_circulation.menu.scan')}
      </Typography>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={2}>
            <TextField
              autoFocus
              fullWidth
              label={t('library_circulation.scan.input_label')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleScan();
              }}
              disabled={busy}
            />
            <Button startIcon={<QrCodeScannerIcon />} variant="contained" onClick={handleScan} disabled={busy || !code.trim()}>
              {t('library_circulation.scan.scan_button')}
            </Button>
            <Button startIcon={<CameraAltIcon />} variant="outlined" onClick={() => setCameraOpen(true)} disabled={busy}>
              {t('library_circulation.scan.camera_button')}
            </Button>
          </Stack>
          <Box sx={{ mt: 2, maxWidth: 400 }}>
            <ReaderAutocomplete
              value={null}
              onChange={handleReaderPicked}
              label={t('library_circulation.scan.search_reader_label')}
              disabled={busy}
            />
          </Box>
        </CardContent>
      </Card>

      <CameraScanDialog open={cameraOpen} onClose={() => setCameraOpen(false)} onDecoded={handleCameraDecoded} />

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      {message ? (
        <Alert severity="success" sx={{ mb: 2 }}>
          {message}
        </Alert>
      ) : null}

      {/* §4.1: two clear sections, side by side on wide viewports (stacked below sm). */}
      {student || bookCopy ? (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            {/* Reader Section */}
            {student ? (
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Stack spacing={2}>
                    <Box>
                      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        {t('library_circulation.scan.student_label')}
                      </Typography>
                      <Typography variant="h5">{student.student.name ?? student.student.code}</Typography>
                    </Box>
                    <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Chip
                        label={`${t('library_circulation.students.code')}: ${student.student.code}`}
                        size="small"
                        variant="outlined"
                      />
                      {student.student.className && (
                        <Chip
                          label={`${t('library_circulation.students.class')}: ${student.student.className}`}
                          size="small"
                          variant="outlined"
                        />
                      )}
                    </Stack>
                    <Chip
                      label={t('library_circulation.scan.active_borrowings_count', { count: student.activeBorrowingsCount })}
                      color="primary"
                      size="small"
                    />
                    <Button variant="text" size="small" onClick={() => setReaderHistoryOpen(true)}>
                      {t('library_circulation.scan.view_borrow_history')}
                    </Button>

                    <Divider />

                    {/* Active borrowings — due date, overdue in red, per-row Return. Independent of whether a book has been scanned into the book section. */}
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
                        <List dense disablePadding>
                          {activeBorrowings.map((b) => (
                            <ListItem
                              key={b.id}
                              disableGutters
                              secondaryAction={
                                <Can permission="library_circulation.return">
                                  <Button size="small" onClick={() => openReturnDialogFromActive(b)} disabled={busy}>
                                    {t('library_circulation.scan.confirm_return')}
                                  </Button>
                                </Can>
                              }
                            >
                              <ListItemText
                                primary={b.bookTitle ?? b.qrCode ?? '—'}
                                secondary={t('library_circulation.borrowings.due_at') + ': ' + formatDateOnly(b.dueAt, language)}
                                slotProps={{ secondary: { color: b.isOverdue ? 'error' : 'text.secondary' } }}
                              />
                            </ListItem>
                          ))}
                        </List>
                      )}
                    </Box>

                    <Divider />

                    {/* Open fines for this reader. */}
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
                  </Stack>
                </CardContent>
              </Card>
            ) : null}
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            {/* Book Section */}
            {bookCopy ? (
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Stack spacing={2}>
                    <Box>
                      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        {t('library_circulation.scan.book_label')}
                      </Typography>
                      <Typography variant="h5">{bookCopy.book?.title ?? bookCopy.copy.qrCode}</Typography>
                    </Box>
                    <Chip
                      label={bookCopy.copy.status}
                      color={bookCopy.copy.status === 'available' ? 'success' : 'warning'}
                      size="small"
                    />
                    {bookCopy.activeBorrowing && student ? (
                      <Box sx={{ p: 1.5, bgcolor: 'warning.lighter', borderRadius: 1, border: '1px solid', borderColor: 'warning.light' }}>
                        <Typography variant="caption" color="text.secondary">
                          {t('library_circulation.scan.currently_borrowed_by', { code: student.student.code })}
                        </Typography>
                      </Box>
                    ) : null}
                    {/* §4.4: a REAL history lookup — has THIS reader borrowed THIS exact copy before (returned, not the current active loan above). */}
                    {priorBorrowByThisReader ? (
                      <Box sx={{ p: 1.5, bgcolor: 'info.lighter', borderRadius: 1, border: '1px solid', borderColor: 'info.light' }}>
                        <Stack spacing={1}>
                          <Typography variant="caption" color="text.secondary">
                            {t('library_circulation.scan.previous_borrow')}
                          </Typography>
                          <Typography variant="body2">
                            {t('library_circulation.scan.previous_borrow_returned', {
                              date: formatDateOnly(priorBorrowByThisReader.returnedAt ?? priorBorrowByThisReader.borrowedAt, language),
                              status: t(`library_circulation.borrowing_status.${priorBorrowByThisReader.status}`, priorBorrowByThisReader.status),
                            })}
                          </Typography>
                        </Stack>
                      </Box>
                    ) : null}
                    <Button variant="text" size="small" onClick={() => setCopyHistoryOpen(true)}>
                      {t('library_circulation.scan.view_copy_history')}
                    </Button>
                    {bookCopy.activeBorrowing ? (
                      <Box sx={{ mt: 2 }}>
                        <Can permission="library_circulation.return">
                          <Button
                            variant="contained"
                            color="secondary"
                            fullWidth
                            onClick={() => openReturnDialog(bookCopy.activeBorrowing!, bookCopy.book?.title ?? bookCopy.copy.qrCode)}
                            disabled={busy}
                          >
                            {t('library_circulation.scan.confirm_return')}
                          </Button>
                        </Can>
                      </Box>
                    ) : null}
                  </Stack>
                </CardContent>
              </Card>
            ) : null}
          </Grid>
        </Grid>
      ) : null}

      {student && bookCopy && !bookCopy.activeBorrowing ? (
        <Can permission="library_circulation.borrow">
          <Button variant="contained" size="large" fullWidth onClick={openBorrowDialog} disabled={busy}>
            {t('library_circulation.scan.confirm_borrow')}
          </Button>
        </Can>
      ) : null}

      {student || bookCopy ? (
        <Button sx={{ mt: 2 }} onClick={reset} disabled={busy}>
          {t('core.common.cancel')}
        </Button>
      ) : null}

      <BorrowDialog
        open={borrowDialogOpen}
        student={student}
        bookCopy={bookCopy}
        loanPeriodDays={loanPeriodDays}
        onBorrow={confirmBorrow}
        onClose={() => setBorrowDialogOpen(false)}
        loading={busy}
      />

      <ReturnDialog
        open={returnDialogOpen}
        borrowing={currentBorrowingForReturn}
        bookLabel={returnBookLabel}
        onReturn={confirmReturn}
        onClose={() => {
          setReturnDialogOpen(false);
          setCurrentBorrowingForReturn(null);
          setReturnBookLabel(null);
        }}
        loading={busy}
      />

      <CopyHistoryDialog
        open={copyHistoryOpen}
        copyId={bookCopy?.copy.id ?? null}
        qrCode={bookCopy?.copy.qrCode}
        onClose={() => setCopyHistoryOpen(false)}
      />

      <ReaderHistoryDialog open={readerHistoryOpen} studentId={student?.student.id ?? null} onClose={() => setReaderHistoryOpen(false)} />

      <CreateFineDialog
        context={damageFineContext}
        onClose={() => setDamageFineContext(null)}
        onCreated={() => {
          setDamageFineContext(null);
          setMessage(t('library_circulation.scan.fine_created'));
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
