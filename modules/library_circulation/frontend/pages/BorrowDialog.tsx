import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../../../apps/web/src/shared/utils/format';
import { type ScanBookCopyResult, type ScanStudentResult } from '../api';

interface BorrowDialogProps {
  open: boolean;
  student: ScanStudentResult | null;
  bookCopy: ScanBookCopyResult | null;
  loanPeriodDays: number;
  onBorrow: (expectedReturnDate?: string, comments?: string) => Promise<void>;
  onClose: () => void;
  loading?: boolean;
}

export function BorrowDialog({ open, student, bookCopy, loanPeriodDays, onBorrow, onClose, loading = false }: BorrowDialogProps) {
  const { t, i18n } = useTranslation();
  const [expectedReturnDate, setExpectedReturnDate] = useState<string>('');
  const [comments, setComments] = useState('');

  const handleOpen = () => {
    if (!student || !bookCopy) return;
    const today = new Date();
    const defaultDueDate = new Date(today);
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

  const handleDialogOpen = () => {
    if (open) {
      handleOpen();
    }
  };

  return (
    <Dialog open={open} onTransitionEnter={handleDialogOpen} maxWidth="sm" fullWidth>
      <DialogTitle>{t('library_circulation.borrow.dialog_title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 2 }}>
          {/* Student Information Card */}
          {student ? (
            <Stack spacing={1}>
              <Typography variant="subtitle2" color="text.secondary">
                {t('library_circulation.scan.student_label')}
              </Typography>
              <Typography variant="h6">{student.student.name ?? student.student.code}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('library_circulation.students.code')}: {student.student.code}
              </Typography>
              {student.student.className && (
                <Typography variant="body2" color="text.secondary">
                  {t('library_circulation.students.class')}: {student.student.className}
                </Typography>
              )}
              <Typography variant="body2" color="text.secondary">
                {t('library_circulation.borrow.current_books_count')}: {student.activeBorrowingsCount}
              </Typography>
            </Stack>
          ) : null}

          {/* Book Copy Information Card */}
          {bookCopy ? (
            <Stack spacing={1}>
              <Typography variant="subtitle2" color="text.secondary">
                {t('library_circulation.scan.book_label')}
              </Typography>
              <Typography variant="h6">{bookCopy.book?.title ?? bookCopy.copy.qrCode}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('library_circulation.books.status')}: {bookCopy.copy.status}
              </Typography>
            </Stack>
          ) : null}

          {/* Borrow Information Cards */}
          <Stack spacing={2}>
            {/* Borrow Date */}
            <Stack spacing={0.5}>
              <Typography variant="subtitle2" color="text.secondary">
                {t('library_circulation.borrow.borrow_date')}
              </Typography>
              <Typography variant="body1">{formatDate(new Date(), i18n.language)}</Typography>
            </Stack>

            {/* Expected Return Date (Editable) */}
            <TextField
              label={t('library_circulation.borrow.expected_return_date')}
              type="date"
              value={expectedReturnDate}
              onChange={(e) => setExpectedReturnDate(e.target.value)}
              fullWidth
              disabled={loading}
              slotProps={{ htmlInput: { min: new Date().toISOString().split('T')[0] } }}
            />

            {/* Comments (Optional) */}
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
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          {t('core.common.cancel')}
        </Button>
        <Button onClick={handleBorrow} variant="contained" disabled={loading || !expectedReturnDate}>
          {t('library_circulation.scan.confirm_borrow')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
