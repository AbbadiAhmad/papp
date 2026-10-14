import { Box, Button, Link as MuiLink } from '@mui/material';
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { websiteApi, type MenuLocation, type WebsiteMenuItem } from '../api';

/** `urlOrSlug` is either an absolute link (`http(s)://…`, or an in-app path starting with `/`) or a bare page slug resolved under this module's public prefix. */
function resolveMenuHref(urlOrSlug: string): string {
  if (/^https?:\/\//.test(urlOrSlug) || urlOrSlug.startsWith('/')) return urlOrSlug;
  return `/site/${urlOrSlug}`;
}

/**
 * One of the site's two menus (header / footer) as a plain row of links — no
 * title or logo (the platform top bar owns branding, WEBSITE-D7/D9). Renders
 * nothing when the menu is empty or fails to load, so a site without menus
 * looks exactly as before. Reads the `@Public()` menu endpoint.
 */
export function SiteMenu({ location }: { location: MenuLocation }) {
  const [items, setItems] = useState<WebsiteMenuItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    websiteApi
      .getPublicMenu(location)
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [location]);

  if (items.length === 0) return null;

  return (
    <Box
      component="nav"
      aria-label={location}
      sx={{
        display: 'flex',
        // Phone: one swipeable row instead of a tall wrapped block, so the page content stays near the top.
        flexWrap: { xs: 'nowrap', sm: 'wrap' },
        overflowX: { xs: 'auto', sm: 'visible' },
        '& > *': { flexShrink: 0 },
        justifyContent: { xs: 'flex-start', sm: location === 'header' ? 'flex-start' : 'center' },
        gap: 1,
        px: 2,
        py: 1,
        bgcolor: 'background.paper',
        borderBottom: location === 'header' ? 1 : 0,
        borderTop: location === 'footer' ? 1 : 0,
        borderColor: 'divider',
      }}
    >
      {items.map((item) =>
        /^https?:\/\//.test(item.urlOrSlug) ? (
          <MuiLink key={item.id} href={item.urlOrSlug} underline="hover" sx={{ px: 1, py: 0.75 }}>
            {item.label}
          </MuiLink>
        ) : (
          <Button key={item.id} component={RouterLink} to={resolveMenuHref(item.urlOrSlug)}>
            {item.label}
          </Button>
        ),
      )}
    </Box>
  );
}
