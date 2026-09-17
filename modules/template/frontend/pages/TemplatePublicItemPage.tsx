import { Alert, Box, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { isNotFoundError, extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { templateApi, type PublicTemplateItem } from '../api';

/**
 * The one deliberate PUBLIC page (docs/MODULE_SPEC.md §7): reachable from a
 * shared link with NO login at all — mounted directly by App.tsx in every
 * auth-status branch (anonymous/must-change-password/authenticated), never
 * behind a login redirect. Mirrors
 * modules/library_catalog/frontend/pages/PublicBookAvailabilityPage.tsx's
 * own shape exactly — copy THAT file's docblock reasoning if you're adding
 * your own module's public page. Deliberately does NOT render inside the
 * authenticated app shell (`PageLayout`'s sidebar/top bar) — an anonymous
 * visitor should see a minimal, self-contained result page.
 */
export function TemplatePublicItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const { t } = useTranslation();
  const [status, setStatus] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading');
  const [item, setItem] = useState<PublicTemplateItem | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    templateApi
      .getPublicItem(itemId as string)
      .then((result) => {
        if (cancelled) return;
        setItem(result);
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
  }, [itemId]);

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: { xs: 3, sm: 6 } }}>
      <Paper sx={{ p: 4, maxWidth: 420, width: '100%' }} elevation={3}>
        {status === 'loading' ? (
          <Stack sx={{ alignItems: 'center' }}>
            <CircularProgress />
          </Stack>
        ) : null}

        {status === 'not_found' ? <Alert severity="warning">{t('template.public.not_found')}</Alert> : null}
        {status === 'error' ? <Alert severity="error">{errorMessage ?? t('core.common.error')}</Alert> : null}

        {status === 'ready' && item ? (
          <Stack spacing={2}>
            <Typography variant="h6">{item.title}</Typography>
            {item.description ? <Typography variant="body1">{item.description}</Typography> : null}
          </Stack>
        ) : null}
      </Paper>
    </Box>
  );
}
