import { Box, List, ListItem, ListItemText, Paper, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { formatDateTime } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { libraryCirculationApi } from '../api';

/**
 * §2.1 (docs/LIBRARY_IMPROVEMENTS.md) — every reader who ever borrowed any
 * copy of a book, most recent first. Lives here rather than as a tab on
 * library_catalog's BookDetailPage: library_catalog must never import from
 * library_circulation (one-directional dependsOn, LIBRARY_CATALOG-D4/D7 —
 * the catalog module stands alone and is installable without circulation
 * ever being present), so a cross-module history view is this module's own
 * page, reached from a plain link on the book's catalog page when
 * library_circulation happens to be installed (see BookDetailPage.tsx's
 * own conditional-link comment for how that check is made without needing
 * the `modules.view` permission).
 */
export function BookHistoryPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { bookId } = useParams<{ bookId: string }>();
  const { status, data: entries, errorMessage, reload } = useGuardedQuery(() =>
    libraryCirculationApi.getBookCirculationHistory(bookId as string, 50),
  );

  return (
    <Box sx={{ maxWidth: 720 }}>
      <Typography variant="h5" gutterBottom>
        {t('library_circulation.book_history.title')}
      </Typography>
      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        {entries && entries.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('library_circulation.book_history.no_history')}
          </Typography>
        ) : (
          <Paper>
            <List>
              {(entries ?? []).map((entry) => (
                <ListItem key={entry.id} divider>
                  <ListItemText
                    primary={`${entry.studentName ?? entry.studentCode} · ${entry.qrCode ?? ''}`}
                    secondary={
                      entry.returnedAt
                        ? t('library_circulation.book_history.borrowed_returned', {
                            borrowed: formatDateTime(entry.borrowedAt, language),
                            returned: formatDateTime(entry.returnedAt, language),
                            status: t(`library_circulation.borrowing_status.${entry.status}`, entry.status),
                          })
                        : t('library_circulation.book_history.borrowed_active', {
                            borrowed: formatDateTime(entry.borrowedAt, language),
                            status: t(`library_circulation.borrowing_status.${entry.status}`, entry.status),
                          })
                    }
                  />
                </ListItem>
              ))}
            </List>
          </Paper>
        )}
      </QueryStateGate>
    </Box>
  );
}
