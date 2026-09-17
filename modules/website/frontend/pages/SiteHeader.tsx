import { AppBar, Box, Button, Link as MuiLink, Toolbar, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { websiteApi, type SiteConfig, type WebsiteMenuItem } from '../api';

/** `urlOrSlug` is either an absolute link (`http(s)://…`, or an in-app path starting with `/`) or a bare page slug meant to resolve under this module's own public prefix. */
function resolveMenuHref(urlOrSlug: string): string {
  if (/^https?:\/\//.test(urlOrSlug) || urlOrSlug.startsWith('/')) {
    return urlOrSlug;
  }
  return `/site/${urlOrSlug}`;
}

/**
 * Public site chrome — reads the header menu + site config through the
 * `@Public()` read endpoints (no auth, no permission gate). Failure to load
 * either (module not yet configured, no header items) degrades to a plain
 * title bar rather than an error, since this renders above every public
 * page including error/not-found states.
 */
export function SiteHeader() {
  const [items, setItems] = useState<WebsiteMenuItem[]>([]);
  const [config, setConfig] = useState<SiteConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    websiteApi
      .getPublicMenu('header')
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch(() => undefined);
    websiteApi
      .getPublicSiteConfig()
      .then((result) => {
        if (!cancelled) setConfig(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppBar position="static" color="default" elevation={1}>
      <Toolbar sx={{ gap: 3 }}>
        {config?.logoUrl ? (
          <Box component="img" src={config.logoUrl} alt={config.siteTitle} sx={{ height: 36 }} />
        ) : null}
        <Typography variant="h6" component={RouterLink} to="/site" sx={{ textDecoration: 'none', color: 'inherit', flexGrow: 1 }}>
          {config?.siteTitle ?? ''}
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          {items.map((item) =>
            /^https?:\/\//.test(item.urlOrSlug) ? (
              <MuiLink key={item.id} href={item.urlOrSlug} underline="hover" color="inherit">
                {item.label}
              </MuiLink>
            ) : (
              <Button key={item.id} component={RouterLink} to={resolveMenuHref(item.urlOrSlug)} color="inherit">
                {item.label}
              </Button>
            ),
          )}
        </Box>
      </Toolbar>
    </AppBar>
  );
}
