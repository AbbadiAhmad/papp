import { Box, Card, CardContent, Chip, LinearProgress, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** One bar/chip entry: `key: null` = "not specified" (e.g. a book with no category). */
export interface StatsCount {
  key: string | null;
  count: number;
}

export type FormatCount = (value: number) => string;

/**
 * Small presentational blocks shared by the statistics pages (library
 * circulation and reading club) so both read the same way: a number tile, a
 * titled card, horizontal bars, chips and a plain table.
 */
export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card variant="outlined" sx={{ minWidth: 150, flex: '1 1 150px' }}>
      <CardContent>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h5">{value}</Typography>
        {hint ? (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function StatSection({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {title}
        </Typography>
        {hint ? (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
            {hint}
          </Typography>
        ) : null}
        {children}
      </CardContent>
    </Card>
  );
}

/** Horizontal bars, one per entry, scaled to the largest. */
export function StatBars({ items, n, limit = 10 }: { items: StatsCount[]; n: FormatCount; limit?: number }) {
  const { t } = useTranslation();
  if (items.length === 0) return <Typography variant="body2" color="text.secondary">{t('core.stats.no_data')}</Typography>;
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <Stack spacing={0.75}>
      {items.slice(0, limit).map((item) => (
        <Box key={item.key ?? '__none'}>
          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
            <Typography variant="body2">{item.key ?? t('core.stats.unspecified')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {n(item.count)}
            </Typography>
          </Stack>
          <LinearProgress variant="determinate" value={(item.count / max) * 100} sx={{ height: 6, borderRadius: 3 }} />
        </Box>
      ))}
    </Stack>
  );
}

export function StatChips({ items, n, limit = 4 }: { items: StatsCount[]; n: FormatCount; limit?: number }) {
  const { t } = useTranslation();
  if (items.length === 0) return <>—</>;
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
      {items.slice(0, limit).map((i) => (
        <Chip key={i.key ?? '__none'} size="small" variant="outlined" label={`${i.key ?? t('core.stats.unspecified')} (${n(i.count)})`} />
      ))}
    </Stack>
  );
}

export function StatTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  const { t } = useTranslation();
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            {head.map((h) => (
              <TableCell key={h}>{h}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={head.length}>
                <Typography variant="body2" color="text.secondary">
                  {t('core.stats.no_data')}
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((cells, i) => (
              <TableRow key={i} hover>
                {cells.map((c, j) => (
                  <TableCell key={j}>{c}</TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
