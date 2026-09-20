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

  const confirmReturn = async (borrowing: LibraryBorrowing) => {
    setBusy(true);
    setError(null);
    try {
      const result = await gated('library_circulation.return', () => libraryCirculationApi.returnBorrowing(borrowing.id));
      setMessage(
        result.daysLate > 0
          ? t('library_circulation.scan.return_success_late', { days: result.daysLate })
          : t('library_circulation.scan.return_success'),
      );
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

      {student ? (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle1">{t('library_circulation.scan.student_label')}</Typography>
            <Typography variant="h6">{student.student.name ?? student.student.code}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t('library_circulation.students.code')}: {student.student.code}
              {student.student.className ? ` · ${student.student.className}` : ''}
            </Typography>
            <Chip
              size="small"
              sx={{ mt: 1 }}
              label={t('library_circulation.scan.active_borrowings_count', { count: student.activeBorrowingsCount })}
            />
          </CardContent>
        </Card>
      ) : null}

      {bookCopy ? (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle1">{t('library_circulation.scan.book_label')}</Typography>
            <Typography variant="h6">{bookCopy.book?.title ?? bookCopy.copy.qrCode}</Typography>
            <Chip size="small" sx={{ mt: 1 }} label={bookCopy.copy.status} />

            {bookCopy.activeBorrowing ? (
              <Box sx={{ mt: 2 }}>
                <Can permission="library_circulation.return">
                  <Button variant="contained" color="secondary" onClick={() => confirmReturn(bookCopy.activeBorrowing!)} disabled={busy}>
                    {t('library_circulation.scan.confirm_return')}
                  </Button>
                </Can>
              </Box>
            ) : null}
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
    </Box>
  );
}
