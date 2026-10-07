import { Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../../../apps/web/src/shared/format';

export interface BorrowDialogBook {
  id: string;
  title: string;
  qrCode: string;
}

interface BorrowDialogProps {
  open: boolean;
  readerName: string | null;
  readerCode: string | null;
  /** Every book in the "new books" list — one due date / comment applies to all of them. */
  books: BorrowDialogBook[];
  loanPeriodDays: number;
  onBorrow: (expectedReturnDate?: string, comments?: string) => Promise<void>;
  onClose: () => void;
  loading?: boolean;
}

export function BorrowDialog({ open, readerName, readerCode, books, loanPeriodDays, onBorrow, onClose, loading = false }: BorrowDialogProps) {
  const { t, i18n } = useTranslation();
  const [expectedReturnDate, setExpectedReturnDate] = useState<string>('');
  const [comments, setComments] = useState('');

  const handleOpen = () => {
    const defaultDueDate = new Date();
    defaultDueDate.setDate(defaultDueDate.getDate() + loanPeriodDays);
    setExpectedReturnDate(defaultDueDate.toISOString().split('T')[0]);
    setComments('');
  };

  const handleClose = () => {
    setExpectedReturnDate('');
    setComments('');
    onClose();
  };

  const handleBorrow = async () => {
    await onBorrow(expectedReturnDate || undefined, comments || undefined);
    handleClose();
  };

  return (
    <Dialog open={open} onTransitionEnter={() => open && handleOpen()} maxWidth="sm" fullWidth>
      <DialogTitle>{t('library_circulation.borrow.dialog_title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 2 }}>
          <Stack spacing={0.5}>
            <Typography variant="subtitle2" color="text.secondary">
              {t('library_circulation.scan.reader_panel_title')}
            </Typography>
            <Typography variant="h6">{readerName ?? readerCode ?? '—'}</Typography>
            {readerCode ? (
              <Typography variant="body2" color="text.secondary">
                {t('library_circulation.students.code')}: {readerCode}
              </Typography>
            ) : null}
          </Stack>

          <Stack spacing={0.5}>
            <Typography variant="subtitle2" color="text.secondary">
              {t('library_circulation.scan.books_panel_title')} ({books.length})
            </Typography>
            <List dense disablePadding>
              {books.map((book) => (
                <ListItem key={book.id} disableGutters>
                  <ListItemText primary={book.title} secondary={book.qrCode} />
                </ListItem>
              ))}
            </List>
          </Stack>

          <Stack spacing={0.5}>
            <Typography variant="subtitle2" color="text.secondary">
              {t('library_circulation.borrow.borrow_date')}
            </Typography>
            <Typography variant="body1">{formatDate(new Date(), i18n.language)}</Typography>
          </Stack>

          <TextField
            label={t('library_circulation.borrow.expected_return_date')}
            type="date"
            value={expectedReturnDate}
            onChange={(e) => setExpectedReturnDate(e.target.value)}
            fullWidth
            disabled={loading}
            slotProps={{ htmlInput: { min: new Date().toISOString().split('T')[0] } }}
          />

          <TextField
            label={t('library_circulation.borrow.comments')}
            multiline
            rows={3}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            fullWidth
            disabled={loading}
            placeholder={t('library_circulation.borrow.comments_placeholder')}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          {t('core.common.cancel')}
        </Button>
        <Button onClick={handleBorrow} variant="contained" disabled={loading || !expectedReturnDate || books.length === 0}>
          {t('library_circulation.scan.borrow_all_button', { count: books.length })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
