import { Alert, Box, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { isNotFoundError, extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { libraryCatalogApi, type BookAvailability } from '../api';

/**
 * The one deliberate PUBLIC page (docs/MODULE_SPEC.md §7, D34): reachable
 * from a shared link with NO login at all — mounted directly by App.tsx in
 * every auth-status branch (anonymous/must-change-password/authenticated),
 * never behind a login redirect. Deliberately does NOT render inside the
 * authenticated app shell (`PageLayout`'s sidebar/top bar) — an anonymous
 * visitor should see a minimal, self-contained result page, not the internal
 * admin chrome.
 */
export function PublicBookAvailabilityPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const { t } = useTranslation();
  const [status, setStatus] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading');
  const [availability, setAvailability] = useState<BookAvailability | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    libraryCatalogApi
      .getPublicAvailability(bookId as string)
      .then((result) => {
        if (cancelled) return;
        setAvailability(result);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isNotFoundError(error)) {
          setStatus('not_found');
          return;
        }
        setStatus('error');
        setErrorMessage(extractErrorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: { xs: 3, sm: 6 } }}>
      <Paper sx={{ p: 4, maxWidth: 420, width: '100%' }} elevation={3}>
        {status === 'loading' ? (
          <Stack spacing={2} sx={{ alignItems: 'center' }}>
            <CircularProgress />
          </Stack>
        ) : null}

        {status === 'not_found' ? <Alert severity="warning">{t('library_catalog.public.not_found')}</Alert> : null}

        {status === 'error' ? <Alert severity="error">{errorMessage ?? t('core.common.error')}</Alert> : null}

        {status === 'ready' && availability ? (
          <Stack spacing={2}>
            <Typography variant="h6">{availability.title}</Typography>
            <Typography variant="body1">
              {t('library_catalog.public.availability_summary', {
                available: availability.availableCopies,
                total: availability.totalCopies,
              })}
            </Typography>
            <Alert severity={availability.availableCopies > 0 ? 'success' : 'info'}>
              {availability.availableCopies > 0
                ? t('library_catalog.public.available')
                : t('library_catalog.public.unavailable')}
            </Alert>
          </Stack>
        ) : null}
      </Paper>
    </Box>
  );
}
