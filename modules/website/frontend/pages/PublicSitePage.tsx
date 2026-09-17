import { Alert, Box, CircularProgress, Stack } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { isNotFoundError, extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { websiteApi, type WebsitePageDetail } from '../api';
import { BlockRenderer } from './BlockRenderer';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

/**
 * The module's one visitor-facing page (manifest routes `/site` and
 * `/site/:slug`, both `access: "public"` — see MODULE_SPEC.md §7): no
 * login, no permission gate, reachable from every App.tsx auth-status
 * branch. `/site` with no `slug` resolves the configured homepage;
 * `/site/:slug` resolves that published page by slug. A draft page, or a
 * slug with no matching page, both surface as the same "not found" state —
 * the backend's own `findPublicBySlug`/`findPublicHomepage` (pages.service.ts)
 * already 404 unless `status === 'published'`, so this page never needs to
 * check status itself.
 */
export function PublicSitePage() {
  const { slug } = useParams<{ slug?: string }>();
  const { t } = useTranslation();
  const [status, setStatus] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading');
  const [page, setPage] = useState<WebsitePageDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Mirrors useGuardedQuery's own convention (see its docblock): status is
    // never reset synchronously inside an effect body, only from the .then/
    // .catch callbacks below — a slug-to-slug navigation briefly keeps the
    // previous page's blocks on screen until the new fetch resolves.
    const request = slug ? websiteApi.getPublicPage(slug) : websiteApi.getPublicHomepage();
    request
      .then((result) => {
        if (cancelled) return;
        setPage(result);
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
  }, [slug]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <SiteHeader />

      <Box sx={{ flex: 1 }}>
        {status === 'loading' ? (
          <Stack sx={{ alignItems: 'center', py: 8 }}>
            <CircularProgress />
          </Stack>
        ) : null}

        {status === 'not_found' ? (
          <Box sx={{ p: 4 }}>
            <Alert severity="warning">{t('website.public.not_found')}</Alert>
          </Box>
        ) : null}

        {status === 'error' ? (
          <Box sx={{ p: 4 }}>
            <Alert severity="error">{errorMessage ?? t('core.common.error')}</Alert>
          </Box>
        ) : null}

        {status === 'ready' && page ? page.blocks.map((block) => <BlockRenderer key={block.id} block={block} />) : null}
      </Box>

      <SiteFooter />
    </Box>
  );
}
