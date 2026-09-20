import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../../../apps/web/src/shared/format';
import { libraryCirculationApi, type LibraryBorrowing, type LibraryFineType, type ReturnFineInput, type ReturnStatus } from '../api';

interface ReturnDialogProps {
  open: boolean;
  borrowing: LibraryBorrowing | null;
  /** The book's title (or qrCode fallback) — ReturnDialog itself never fetches this, the two call sites in ScanPage.tsx already have it either from the scanned bookCopy or the active-borrowings list. */
  bookLabel?: string | null;
  onReturn: (returnStatus: string, returnNotes?: string, returnedAt?: string, fine?: ReturnFineInput) => Promise<void>;
  onClose: () => void;
  loading?: boolean;
}

const RETURN_STATUSES: { value: ReturnStatus; labelKey: string }[] = [
  { value: 'returned', labelKey: 'library_circulation.return.status_returned' },
  { value: 'damaged', labelKey: 'library_circulation.return.status_damaged' },
  { value: 'lost', labelKey: 'library_circulation.return.status_lost' },
  { value: 'other', labelKey: 'library_circulation.return.status_other' },
];

const toDateInputValue = (date: Date) => date.toISOString().split('T')[0];

export function ReturnDialog({ open, borrowing, bookLabel, onReturn, onClose, loading = false }: ReturnDialogProps) {
  const { t, i18n } = useTranslation();
  const [returnStatus, setReturnStatus] = useState<ReturnStatus>('returned');
  const [notes, setNotes] = useState('');
  const [returnedAt, setReturnedAt] = useState('');
  const [addFine, setAddFine] = useState(false);
  const [fineTypes, setFineTypes] = useState<LibraryFineType[]>([]);
  const [fineTypeId, setFineTypeId] = useState('');
  const [fineAmount, setFineAmount] = useState('');
  const [fineNotes, setFineNotes] = useState('');

  const handleOpen = () => {
    if (!borrowing) return;
    setReturnStatus('returned');
    setNotes('');
    setReturnedAt(toDateInputValue(new Date()));
    setAddFine(false);
    setFineTypeId('');
    setFineAmount('');
    setFineNotes('');
    libraryCirculationApi.listFineTypes().then(setFineTypes);
  };

  const handleClose = () => {
    onClose();
  };

  const handleReturn = async () => {
    const fine = addFine && fineTypeId && fineAmount ? { fineTypeId, amount: Number(fineAmount), notes: fineNotes || undefined } : undefined;
    await onReturn(returnStatus, notes || undefined, returnedAt || undefined, fine);
    handleClose();
  };

  const handleDialogOpen = () => {
    if (open) {
      handleOpen();
    }
  };

  const handleFineTypeChange = (id: string) => {
    setFineTypeId(id);
    const match = fineTypes.find((ft) => ft.id === id);
    if (match) setFineAmount(match.defaultAmount);
  };

  const calculateDaysLate = (): number => {
    if (!borrowing || !returnedAt) return 0;
    const dueDate = new Date(borrowing.dueAt);
    const actual = new Date(returnedAt);
    const daysLate = Math.max(0, Math.ceil((actual.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000)));
    return daysLate;
  };

  const daysLate = calculateDaysLate();

  // Once a return status/fine type is picked, pre-fill a reasonable default
  // amount so the librarian reviews/adjusts rather than types from scratch —
  // matches damage/lost code to the matching seeded fine type, same lookup
  // ScanPage's own post-return CreateFineDialog already used.
  useEffect(() => {
    if (!addFine || fineTypeId || fineTypes.length === 0) return;
    const matchingCode = returnStatus === 'damaged' ? 'FINE-DAMAGE' : returnStatus === 'lost' ? 'FINE-LOST' : 'FINE-LATE';
    const match = fineTypes.find((ft) => ft.code === matchingCode) ?? fineTypes[0];
    if (match) {
      setFineTypeId(match.id);
      setFineAmount(match.defaultAmount);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addFine, fineTypes, returnStatus]);

  return (
    <Dialog open={open} onTransitionEnter={handleDialogOpen} maxWidth="sm" fullWidth>
      <DialogTitle>{t('library_circulation.return.dialog_title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 2 }}>
          {borrowing ? (
            <>
              {bookLabel ? (
                <Stack spacing={0.5}>
                  <Typography variant="subtitle2" color="text.secondary">
                    {t('library_circulation.scan.book_label')}
                  </Typography>
                  <Typography variant="h6">{bookLabel}</Typography>
                </Stack>
              ) : null}

              {/* Borrowed Date */}
              <Stack spacing={0.5}>
                <Typography variant="subtitle2" color="text.secondary">
                  {t('library_circulation.return.borrowed_date')}
                </Typography>
                <Typography variant="body1">{formatDate(new Date(borrowing.borrowedAt), i18n.language)}</Typography>
              </Stack>

              {/* Expected Return Date */}
              <Stack spacing={0.5}>
                <Typography variant="subtitle2" color="text.secondary">
                  {t('library_circulation.return.expected_return_date')}
                </Typography>
                <Typography variant="body1">{formatDate(new Date(borrowing.dueAt), i18n.language)}</Typography>
              </Stack>

              {/* Actual Return Date — editable, defaults to today (backdating support). */}
              <TextField
                label={t('library_circulation.return.actual_return_date')}
                type="date"
                value={returnedAt}
                onChange={(e) => setReturnedAt(e.target.value)}
                fullWidth
                disabled={loading}
                slotProps={{ htmlInput: { max: toDateInputValue(new Date()) } }}
              />

              {/* Days Late */}
              <Stack spacing={0.5}>
                <Typography variant="subtitle2" color="text.secondary">
                  {t('library_circulation.return.days_late')}
                </Typography>
                <Typography variant="body1" color={daysLate > 0 ? 'error' : 'text.primary'}>
                  {daysLate}
                </Typography>
              </Stack>

              {/* Return Status */}
              <Select
                label={t('library_circulation.return.status')}
                value={returnStatus}
                onChange={(e) => setReturnStatus(e.target.value as ReturnStatus)}
                disabled={loading}
                fullWidth
              >
                {RETURN_STATUSES.map((status) => (
                  <MenuItem key={status.value} value={status.value}>
                    {t(status.labelKey)}
                  </MenuItem>
                ))}
              </Select>

              {/* Return Notes (Optional) */}
              <TextField
                label={t('library_circulation.return.notes')}
                multiline
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                fullWidth
                disabled={loading}
                placeholder={t('library_circulation.return.notes_placeholder')}
              />

              {/* Inline extendable "add fine" — created in the SAME confirm action, not a separate follow-up step. */}
              <Stack spacing={1.5}>
                <FormControlLabel
                  control={<Checkbox checked={addFine} onChange={(e) => setAddFine(e.target.checked)} disabled={loading} />}
                  label={t('library_circulation.return.add_fine')}
                />
                {addFine ? (
                  <Stack spacing={2} sx={{ pl: 4 }}>
                    <TextField
                      select
                      label={t('library_circulation.fines.fine_type')}
                      value={fineTypeId}
                      onChange={(e) => handleFineTypeChange(e.target.value)}
                      disabled={loading}
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
                      value={fineAmount}
                      onChange={(e) => setFineAmount(e.target.value)}
                      disabled={loading}
                    />
                    <TextField
                      label={t('library_circulation.return.notes')}
                      value={fineNotes}
                      onChange={(e) => setFineNotes(e.target.value)}
                      multiline
                      minRows={2}
                      disabled={loading}
                    />
                  </Stack>
                ) : (returnStatus === 'damaged' || returnStatus === 'lost' || daysLate > 0) ? (
                  <Typography variant="body2" color="warning.main">
                    {t('library_circulation.return.suggest_fine', { reason: returnStatus === 'returned' ? 'late' : returnStatus })}
                  </Typography>
                ) : null}
              </Stack>
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          {t('core.common.cancel')}
        </Button>
        <Button onClick={handleReturn} variant="contained" disabled={loading}>
          {t('library_circulation.return.complete_return')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
