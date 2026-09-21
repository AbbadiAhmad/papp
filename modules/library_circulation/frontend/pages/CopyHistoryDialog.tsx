import { Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../../../apps/web/src/shared/format';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { libraryCirculationApi, type CopyCirculationHistoryEntry } from '../api';

/**
 * §4.3 (docs/LIBRARY_IMPROVEMENTS.md) — "last 10 actions" popup for a book
 * copy, opened from ScanPage's Book section. Backed by
 * CirculationService.getCirculationHistory() (§2.2), which existed and was
 * reachable by HTTP since last session but had no caller anywhere in the
 * frontend until this component.
 */
export function CopyHistoryDialog({ open, copyId, qrCode, onClose }: { open: boolean; copyId: string | null; qrCode?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [entries, setEntries] = useState<CopyCirculationHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !copyId) return;
    setEntries(null);
    setError(null);
    libraryCirculationApi
      .getCopyCirculationHistory(copyId)
      .then(setEntries)
      .catch((err) => setError(extractErrorMessage(err)));
  }, [open, copyId]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('library_circulation.scan.copy_history_title', { qrCode: qrCode ?? '' })}</DialogTitle>
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
                  primary={`${t('library_circulation.students.code')}: ${entry.studentCode}`}
                  secondary={
                    entry.returnedAt
                      ? t('library_circulation.scan.history_borrowed_returned', {
                          borrowed: formatDateTime(entry.borrowedAt, language),
                          returned: formatDateTime(entry.returnedAt, language),
                          status: t(`library_circulation.borrowing_status.${entry.status}`, entry.status),
                        })
                      : t('library_circulation.scan.history_borrowed_active', {
                          borrowed: formatDateTime(entry.borrowedAt, language),
                          status: t(`library_circulation.borrowing_status.${entry.status}`, entry.status),
                        })
                  }
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
