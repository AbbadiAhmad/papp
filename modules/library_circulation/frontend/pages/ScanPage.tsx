import CameraAltIcon from '@mui/icons-material/CameraAlt';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { Alert, Box, Button, Card, CardContent, Chip, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { libraryCirculationApi, type LibraryBorrowing, type ScanBookCopyResult, type ScanStudentResult } from '../api';
import { BorrowDialog } from './BorrowDialog';
import { CameraScanDialog } from './CameraScanDialog';
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
  const [loanPeriodDays, setLoanPeriodDays] = useState(14);

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

  const openReturnDialog = (borrowing: LibraryBorrowing) => {
    setCurrentBorrowingForReturn(borrowing);
    setReturnDialogOpen(true);
  };

  const confirmReturn = async (returnStatus: string, returnNotes?: string) => {
    if (!currentBorrowingForReturn) return;
    setBusy(true);
    setError(null);
    try {
      const result = await gated('library_circulation.return', () =>
        libraryCirculationApi.returnBorrowing(currentBorrowingForReturn.id, returnStatus, returnNotes),
      );
      setMessage(
        result.daysLate > 0
          ? t('library_circulation.scan.return_success_late', { days: result.daysLate })
          : t('library_circulation.scan.return_success'),
      );
      setCurrentBorrowingForReturn(null);
      reset();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 640 }}>
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

      {/* Reader Section */}
      {student ? (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack spacing={2}>
              <Box>
                <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  {t('library_circulation.scan.student_label')}
                </Typography>
                <Typography variant="h5">{student.student.name ?? student.student.code}</Typography>
              </Box>
              <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
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
              <Button variant="text" size="small">
                {t('library_circulation.scan.view_borrow_history')}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      ) : null}

      {/* Book Section */}
      {bookCopy ? (
        <Card sx={{ mb: 3 }}>
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
                <Box sx={{ p: 1.5, bgcolor: 'info.lighter', borderRadius: 1, border: '1px solid', borderColor: 'info.light' }}>
                  <Stack spacing={1}>
                    <Typography variant="caption" color="text.secondary">
                      {t('library_circulation.scan.previous_borrow')}
                    </Typography>
                    <Typography variant="body2">
                      {t('library_circulation.students.code')}: {student.student.code}
                    </Typography>
                    {bookCopy.activeBorrowing.returnedAt ? (
                      <Typography variant="caption" color="text.secondary">
                        {t('library_circulation.scan.previous_borrow_returned', {
                          date: new Date(bookCopy.activeBorrowing.returnedAt).toLocaleDateString(),
                          status: bookCopy.activeBorrowing.status,
                        })}
                      </Typography>
                    ) : null}
                  </Stack>
                </Box>
              ) : null}
              <Button variant="text" size="small">
                {t('library_circulation.scan.view_copy_history')}
              </Button>
              {bookCopy.activeBorrowing ? (
                <Box sx={{ mt: 2 }}>
                  <Can permission="library_circulation.return">
                    <Button variant="contained" color="secondary" fullWidth onClick={() => openReturnDialog(bookCopy.activeBorrowing!)} disabled={busy}>
                      {t('library_circulation.scan.confirm_return')}
                    </Button>
                  </Can>
                </Box>
              ) : null}
            </Stack>
          </CardContent>
        </Card>
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
        onReturn={confirmReturn}
        onClose={() => {
          setReturnDialogOpen(false);
          setCurrentBorrowingForReturn(null);
        }}
        loading={busy}
      />
    </Box>
  );
}
