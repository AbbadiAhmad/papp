import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { formatNumber } from '../../../../apps/web/src/shared/format';
import { readingClubApi, type ReadingClubStageBookEntry } from '../api';

/**
 * Popup shown before a librarian confirms a reader's stage as finished
 * (READING_CLUB-D29): lists the books counted for the stage with their
 * category, pages and reading level, so the librarian can check what was
 * read before handing over the present. Discarded entries are not shown.
 */
export function ConfirmStageDialog({
  open,
  studentId,
  stageName,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  studentId: string;
  stageName: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [entries, setEntries] = useState<ReadingClubStageBookEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEntries(null);
    setError(null);
    readingClubApi
      .listBookEntries(studentId)
      .then((list) => {
        if (!cancelled) setEntries(list.filter((e) => e.status === 'active'));
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, studentId]);

  const totalPages = (entries ?? []).reduce((sum, e) => sum + (e.pageCount ?? 0), 0);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('reading_club.confirm_stage.title', { stage: stageName })}</DialogTitle>
      <DialogContent>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {!entries && !error ? <CircularProgress size={24} /> : null}
        {entries ? (
          entries.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('reading_club.confirm_stage.no_books')}
            </Typography>
          ) : (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                {t('reading_club.confirm_stage.summary', { books: formatNumber(entries.length, language), pages: formatNumber(totalPages, language) })}
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('reading_club.confirm_stage.book')}</TableCell>
                      <TableCell>{t('reading_club.confirm_stage.category')}</TableCell>
                      <TableCell>{t('reading_club.confirm_stage.pages')}</TableCell>
                      <TableCell>{t('reading_club.confirm_stage.level')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>{entry.bookTitle}</TableCell>
                        <TableCell>{entry.category ?? '—'}</TableCell>
                        <TableCell>{entry.pageCount != null ? formatNumber(entry.pageCount, language) : '—'}</TableCell>
                        <TableCell>{entry.readingLevel ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Stack>
          )
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('core.common.cancel')}</Button>
        <Button variant="contained" color="success" onClick={onConfirm} disabled={busy || !entries}>
          {t('reading_club.confirm_stage.confirm_button')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
