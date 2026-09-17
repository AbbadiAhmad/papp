import { Box, Container, Link as MuiLink, Stack } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { websiteApi, type WebsiteMenuItem } from '../api';

function resolveMenuHref(urlOrSlug: string): string {
  if (/^https?:\/\//.test(urlOrSlug) || urlOrSlug.startsWith('/')) {
    return urlOrSlug;
  }
  return `/site/${urlOrSlug}`;
}

/** Mirrors `SiteHeader`'s own quiet-failure behavior — see its docblock. */
export function SiteFooter() {
  const [items, setItems] = useState<WebsiteMenuItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    websiteApi
      .getPublicMenu('footer')
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <Box component="footer" sx={{ borderTop: 1, borderColor: 'divider', py: 3, mt: 'auto' }}>
      <Container>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
          {items.map((item) =>
            /^https?:\/\//.test(item.urlOrSlug) ? (
              <MuiLink key={item.id} href={item.urlOrSlug} underline="hover" color="text.secondary">
                {item.label}
              </MuiLink>
            ) : (
              <MuiLink key={item.id} component={RouterLink} to={resolveMenuHref(item.urlOrSlug)} underline="hover" color="text.secondary">
                {item.label}
              </MuiLink>
            ),
          )}
        </Stack>
      </Container>
    </Box>
  );
}
