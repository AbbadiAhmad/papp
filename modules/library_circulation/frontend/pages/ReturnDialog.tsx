import { Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../../../apps/web/src/shared/format';
import { type LibraryBorrowing, type ReturnStatus } from '../api';

interface ReturnDialogProps {
  open: boolean;
  borrowing: LibraryBorrowing | null;
  onReturn: (returnStatus: string, returnNotes?: string) => Promise<void>;
  onClose: () => void;
  loading?: boolean;
}

const RETURN_STATUSES: { value: ReturnStatus; labelKey: string }[] = [
  { value: 'returned', labelKey: 'library_circulation.return.status_returned' },
  { value: 'damaged', labelKey: 'library_circulation.return.status_damaged' },
  { value: 'lost', labelKey: 'library_circulation.return.status_lost' },
  { value: 'other', labelKey: 'library_circulation.return.status_other' },
];

export function ReturnDialog({ open, borrowing, onReturn, onClose, loading = false }: ReturnDialogProps) {
  const { t, i18n } = useTranslation();
  const [returnStatus, setReturnStatus] = useState<ReturnStatus>('returned');
  const [notes, setNotes] = useState('');

  const handleOpen = () => {
    if (!borrowing) return;
    setReturnStatus('returned');
    setNotes('');
  };

  const handleClose = () => {
    setReturnStatus('returned');
    setNotes('');
    onClose();
  };

  const handleReturn = async () => {
    await onReturn(returnStatus, notes || undefined);
    handleClose();
  };

  const handleDialogOpen = () => {
    if (open) {
      handleOpen();
    }
  };

  const calculateDaysLate = (): number => {
    if (!borrowing) return 0;
    const dueDate = new Date(borrowing.dueAt);
    const today = new Date();
    const daysLate = Math.max(0, Math.ceil((today.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000)));
    return daysLate;
  };

  const daysLate = calculateDaysLate();

  return (
    <Dialog open={open} onTransitionEnter={handleDialogOpen} maxWidth="sm" fullWidth>
      <DialogTitle>{t('library_circulation.return.dialog_title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 2 }}>
          {borrowing ? (
            <>
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

              {/* Actual Return Date (Today) */}
              <Stack spacing={0.5}>
                <Typography variant="subtitle2" color="text.secondary">
                  {t('library_circulation.return.actual_return_date')}
                </Typography>
                <Typography variant="body1">{formatDate(new Date(), i18n.language)}</Typography>
              </Stack>

              {/* Days Late */}
              <Stack spacing={0.5}>
                <Typography variant="subtitle2" color="text.secondary">
                  {t('library_circulation.return.days_late')}
                </Typography>
                <Typography variant="body1">{daysLate}</Typography>
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

              {/* Fine Suggestion for Damage/Loss */}
              {(returnStatus === 'damaged' || returnStatus === 'lost') && (
                <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
                  {t('library_circulation.return.suggest_fine', { reason: returnStatus })}
                </Typography>
              )}
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
