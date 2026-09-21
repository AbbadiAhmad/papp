import { Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { libraryCirculationApi, type LibraryBorrowing } from '../api';

const RECENT_LIMIT = 10;

/**
 * §4.2 (docs/LIBRARY_IMPROVEMENTS.md) — "last 10 borrowings" popup for a
 * reader, opened from ScanPage's Reader section. Reuses
 * StudentsService.getReadingHistory() (§3.2's full reading-history
 * endpoint) rather than a new `/readers/:id/borrowings?limit=10` endpoint
 * the original proposal sketched — same data, this dialog just slices to
 * the most recent RECENT_LIMIT client-side, avoiding a second near-
 * duplicate backend endpoint for the same query shape.
 */
export function ReaderHistoryDialog({ open, studentId, onClose }: { open: boolean; studentId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [entries, setEntries] = useState<LibraryBorrowing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !studentId) return;
    setEntries(null);
    setError(null);
    libraryCirculationApi
      .getStudentReadingHistory(studentId)
      .then((history) => setEntries(history.slice(0, RECENT_LIMIT)))
      .catch((err) => setError(extractErrorMessage(err)));
  }, [open, studentId]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('library_circulation.scan.reader_history_title')}</DialogTitle>
      <DialogContent>
        {error ? (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        ) : entries === null ? (
          <Typography variant="body2" color="text.secondary">
            {t('core.common.loading')}
          </Typography>
        ) : entries.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('library_circulation.scan.no_history')}
          </Typography>
        ) : (
          <List dense>
            {entries.map((entry) => (
              <ListItem key={entry.id} divider>
                <ListItemText
                  primary={`${t('library_circulation.borrowings.borrowed_at')}: ${formatDateOnly(entry.borrowedAt, language)} — ${t('library_circulation.borrowings.due_at')}: ${formatDateOnly(entry.dueAt, language)}`}
                  secondary={t(`library_circulation.borrowing_status.${entry.status}`, entry.status)}
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('core.common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
