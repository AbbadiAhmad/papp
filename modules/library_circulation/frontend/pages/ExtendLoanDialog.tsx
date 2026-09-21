import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../../../apps/web/src/shared/format';
import { type LibraryBorrowing } from '../api';

interface ExtendLoanDialogProps {
  open: boolean;
  borrowing: LibraryBorrowing | null;
  loanPeriodDays: number;
  onExtend: (newDueDate: string) => Promise<void>;
  onClose: () => void;
  loading?: boolean;
}

const toDateInputValue = (date: Date): string => date.toISOString().split('T')[0];

export function ExtendLoanDialog({ open, borrowing, loanPeriodDays, onExtend, onClose, loading = false }: ExtendLoanDialogProps) {
  const { t, i18n } = useTranslation();
  const [newDueDate, setNewDueDate] = useState<string>('');

  const handleOpen = () => {
    if (!borrowing) return;
    const defaultNewDueDate = new Date(borrowing.dueAt);
    defaultNewDueDate.setDate(defaultNewDueDate.getDate() + loanPeriodDays);
    setNewDueDate(toDateInputValue(defaultNewDueDate));
  };

  const handleClose = () => {
    setNewDueDate('');
    onClose();
  };

  const handleExtend = async () => {
    await onExtend(newDueDate);
    handleClose();
  };

  const handleDialogOpen = () => {
    if (open) {
      handleOpen();
    }
  };

  const minDueDate = borrowing
    ? (() => {
        const dayAfter = new Date(borrowing.dueAt);
        dayAfter.setDate(dayAfter.getDate() + 1);
        return toDateInputValue(dayAfter);
      })()
    : undefined;

  return (
    <Dialog open={open} onTransitionEnter={handleDialogOpen} maxWidth="sm" fullWidth>
      <DialogTitle>{t('library_circulation.extend.dialog_title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 2 }}>
          {borrowing ? (
            <Stack spacing={0.5}>
              <Typography variant="subtitle2" color="text.secondary">
                {t('library_circulation.extend.current_due_date')}
              </Typography>
              <Typography variant="body1">{formatDate(new Date(borrowing.dueAt), i18n.language)}</Typography>
            </Stack>
          ) : null}

          <TextField
            label={t('library_circulation.extend.new_due_date')}
            type="date"
            value={newDueDate}
            onChange={(e) => setNewDueDate(e.target.value)}
            fullWidth
            disabled={loading}
            slotProps={{ htmlInput: { min: minDueDate } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          {t('core.common.cancel')}
        </Button>
        <Button onClick={handleExtend} variant="contained" disabled={loading || !newDueDate}>
          {t('library_circulation.extend.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
