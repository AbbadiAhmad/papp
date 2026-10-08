import { alpha, Box, Card, CardActionArea, Typography, type SxProps, type Theme } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import type { ReactNode } from 'react';

/**
 * Shared page building blocks (restyle, D97). They take every color, radius
 * and font from the active MUI theme, so a theme pack or dark mode restyles
 * them with no per-page work. Modules import them by relative path exactly
 * like they already import `QueryStateGate` from `apps/web/src/shared`.
 * Strings are always passed in already translated; nothing here owns copy.
 */

export type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

const toneColor = (tone: Tone) => (theme: Theme): string =>
  tone === 'neutral' ? theme.palette.text.secondary : theme.palette[tone].main;

/** A status as a soft pill with a dot, e.g. Borrowed / Due soon / Overdue / Returned / Available. */
export function StatusPill({ tone, label, sx }: { tone: Tone; label: ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Box
      component="span"
      sx={[
        (theme) => ({
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.25,
          py: 0.25,
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 700,
          lineHeight: 1.6,
          whiteSpace: 'nowrap',
          color: toneColor(tone)(theme),
          bgcolor: alpha(toneColor(tone)(theme), theme.palette.mode === 'dark' ? 0.2 : 0.12),
          '&::before': { content: '""', width: 7, height: 7, borderRadius: '50%', bgcolor: 'currentColor' },
        }),
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {label}
    </Box>
  );
}

/** Stacked-books illustration used by `PageHero`. Decorative. */
function BooksIllustration() {
  return (
    <svg width="76" height="76" viewBox="0 0 84 84" aria-hidden="true" focusable="false">
      <rect x="8" y="50" width="68" height="16" rx="4" fill="#3d9a5a" />
      <rect x="14" y="34" width="58" height="16" rx="4" fill="#e8923a" />
      <rect x="10" y="18" width="62" height="16" rx="4" fill="#3b78d8" />
      <rect x="20" y="24" width="30" height="3" rx="1.5" fill="#fff" opacity=".7" />
    </svg>
  );
}

/** The welcome / page banner: a soft accent panel with title, one line of context and an optional action. */
export function PageHero({ title, subtitle, action, illustration = true }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; illustration?: boolean }) {
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 2.5,
        flexWrap: 'wrap',
        p: { xs: 2, sm: 3 },
        borderRadius: `${theme.shape.borderRadius}px`,
        bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.1),
      })}
    >
      {illustration ? <BooksIllustration /> : null}
      <Box sx={{ flex: 1, minWidth: 200 }}>
        <Typography variant="h4" component="h2" sx={{ textWrap: 'balance' }}>
          {title}
        </Typography>
        {subtitle ? (
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        ) : null}
      </Box>
      {action}
    </Box>
  );
}

/** A headline figure. With `to` the whole tile is a link (click a stat, land on what it counts). */
export function StatTile({ label, value, tone = 'neutral', to, icon }: { label: ReactNode; value: ReactNode; tone?: Tone; to?: string | null; icon?: ReactNode }) {
  const body = (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
        {icon}
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
      </Box>
      <Typography component="div" sx={(theme) => ({ fontSize: 30, fontWeight: 800, lineHeight: 1.15, color: tone === 'neutral' ? theme.palette.text.primary : toneColor(tone)(theme), fontVariantNumeric: 'tabular-nums' })}>
        {value}
      </Typography>
    </Box>
  );
  return <Card>{to ? <CardActionArea component={RouterLink} to={to}>{body}</CardActionArea> : body}</Card>;
}

/** Responsive grid for stat tiles / book cards. Items fill the row; never stretches a lone item across the page. */
export function CardGrid({ children, min = 170 }: { children: ReactNode; min?: number }) {
  return <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}>{children}</Box>;
}

const COVER_GRADIENTS: [string, string][] = [
  ['#3b78d8', '#27559f'], ['#c2701f', '#8a4a10'], ['#2f9a57', '#1d6b3a'], ['#8c4ab8', '#5e2d82'],
  ['#d9534f', '#a02e2a'], ['#1d3c78', '#0e2048'], ['#a77c0b', '#76560a'], ['#16897f', '#0c5a53'],
];

/** Stable pick per title so a book keeps the same cover color everywhere. */
export function coverGradientIndex(title: string): number {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return hash % COVER_GRADIENTS.length;
}

/**
 * A book cover. Uses `imageUrl` when a real photo exists (the future cover
 * feature plugs in here, nothing else changes); otherwise a generated cover
 * from the title and author.
 */
export function BookCover({ title, author, imageUrl }: { title: string; author?: string | null; imageUrl?: string | null }) {
  if (imageUrl) {
    return <Box component="img" src={imageUrl} alt={title} sx={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 1 }} />;
  }
  const [from, to] = COVER_GRADIENTS[coverGradientIndex(title)];
  return (
    <Box
      aria-hidden
      sx={{
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        aspectRatio: '3 / 4',
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        color: '#fff',
        borderRadius: 1.5,
        background: `linear-gradient(150deg, ${from}, ${to})`,
        boxShadow: '0 3px 8px rgba(0,0,0,.18)',
        '&::after': { content: '""', position: 'absolute', insetInlineEnd: -28, bottom: -28, width: 90, height: 90, borderRadius: '50%', bgcolor: 'rgba(255,255,255,.14)' },
      }}
    >
      <Typography variant="caption" sx={{ opacity: 0.85, fontWeight: 600 }}>
        {author ?? ''}
      </Typography>
      <Typography sx={{ fontWeight: 800, lineHeight: 1.25, fontSize: 16, textWrap: 'balance' }}>{title}</Typography>
    </Box>
  );
}

/** Book card: cover, title, author, an availability pill and optional actions. */
export function BookCard({ title, author, imageUrl, to, status, actions }: { title: string; author?: string | null; imageUrl?: string | null; to?: string; status?: ReactNode; actions?: ReactNode }) {
  const top = (
    <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <BookCover title={title} author={author} imageUrl={imageUrl} />
      <Typography sx={{ fontWeight: 700, lineHeight: 1.3, mt: 0.5 }}>{title}</Typography>
      {author ? (
        <Typography variant="body2" color="text.secondary">
          {author}
        </Typography>
      ) : null}
      {status}
    </Box>
  );
  return (
    <Card sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {to ? <CardActionArea component={RouterLink} to={to} sx={{ flexGrow: 1 }}>{top}</CardActionArea> : <Box sx={{ flexGrow: 1 }}>{top}</Box>}
      {actions ? <Box sx={{ px: 1.5, pb: 1.5, display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>{actions}</Box> : null}
    </Card>
  );
}
