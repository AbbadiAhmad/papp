import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  LinearProgress,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { formatNumber } from '../../../../apps/web/src/shared/format';
import {
  readingClubApi,
  type ClubStatistics,
  type StatisticsQuery,
  type StatsAgeBand,
  type StatsCount,
  type StatsGroup,
} from '../api';
import { EpisodeSwitcher } from './EpisodeSwitcher';

type TabKey = 'overview' | 'groups' | 'books' | 'age';

/**
 * Club + library statistics, to judge whether the stages and levels fit the
 * readers and which books to buy: totals, top readers, per group/stage
 * progress with what is being read there, most borrowed and best rated
 * books, and what each age group reads. Filters: club episode, period, age
 * group width. Everything is computed server-side (`GET /statistics`).
 */
export function StatisticsPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [tab, setTab] = useState<TabKey>('overview');
  const [episodeId, setEpisodeId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [bandYears, setBandYears] = useState(2);
  const [applied, setApplied] = useState<StatisticsQuery>({ ageBandYears: 2 });
  const [data, setData] = useState<ClubStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    readingClubApi
      .getStatistics(applied)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(extractErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applied]);

  const apply = () => setApplied({ episodeId: episodeId || undefined, from: from || undefined, to: to || undefined, ageBandYears: bandYears });
  const n = (value: number) => formatNumber(value, language);

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('reading_club.stats.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 760 }}>
        {t('reading_club.stats.subtitle')}
      </Typography>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 2 }}>
            <EpisodeSwitcher episodeId={episodeId} onEpisodeChange={setEpisodeId} />
            <TextField type="date" size="small" label={t('reading_club.stats.from')} value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField type="date" size="small" label={t('reading_club.stats.to')} value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField select size="small" label={t('reading_club.stats.age_band')} value={bandYears} onChange={(e) => setBandYears(Number(e.target.value))} sx={{ minWidth: 150 }}>
              {[1, 2, 3, 5].map((y) => (
                <MenuItem key={y} value={y}>
                  {t('reading_club.stats.age_band_years', { count: y })}
                </MenuItem>
              ))}
            </TextField>
            <Button variant="contained" onClick={apply} disabled={loading}>
              {t('reading_club.stats.apply')}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
            {t('reading_club.stats.period_hint')}
          </Typography>
        </CardContent>
      </Card>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      {loading && !data ? <CircularProgress /> : null}

      {data ? (
        <>
          <Tabs value={tab} onChange={(_e, v: TabKey) => setTab(v)} sx={{ mb: 2 }} variant="scrollable" scrollButtons="auto">
            <Tab value="overview" label={t('reading_club.stats.tab_overview')} />
            <Tab value="groups" label={t('reading_club.stats.tab_groups')} />
            <Tab value="books" label={t('reading_club.stats.tab_books')} />
            <Tab value="age" label={t('reading_club.stats.tab_age')} />
          </Tabs>
          <Box sx={{ opacity: loading ? 0.5 : 1 }}>
            {tab === 'overview' ? <Overview data={data} n={n} /> : null}
            {tab === 'groups' ? <Groups data={data} n={n} /> : null}
            {tab === 'books' ? <Books data={data} n={n} /> : null}
            {tab === 'age' ? <AgeGroups data={data} n={n} /> : null}
          </Box>
        </>
      ) : null}
    </Box>
  );
}

type N = (value: number) => string;

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
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

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
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
function Bars({ items, n, limit = 10 }: { items: StatsCount[]; n: N; limit?: number }) {
  const { t } = useTranslation();
  if (items.length === 0) return <Typography variant="body2" color="text.secondary">{t('reading_club.stats.no_data')}</Typography>;
  const max = Math.max(...items.map((i) => i.count));
  return (
    <Stack spacing={0.75}>
      {items.slice(0, limit).map((item) => (
        <Box key={item.key ?? '__none'}>
          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
            <Typography variant="body2">{item.key ?? t('reading_club.stats.unspecified')}</Typography>
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

function Chips({ items, n, limit = 4 }: { items: StatsCount[]; n: N; limit?: number }) {
  const { t } = useTranslation();
  if (items.length === 0) return <>—</>;
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
      {items.slice(0, limit).map((i) => (
        <Chip key={i.key ?? '__none'} size="small" variant="outlined" label={`${i.key ?? t('reading_club.stats.unspecified')} (${n(i.count)})`} />
      ))}
    </Stack>
  );
}

function SimpleTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
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
                  {t('reading_club.stats.no_data')}
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

// --- tabs ---------------------------------------------------------------------

function Overview({ data, n }: { data: ClubStatistics; n: N }) {
  const { t } = useTranslation();
  const club = data.club;
  return (
    <>
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2, mb: 2 }}>
        <Tile label={t('reading_club.stats.readers')} value={n(data.readers.total)} hint={t('reading_club.stats.readers_active', { count: data.readers.active })} />
        <Tile label={t('reading_club.stats.borrowings')} value={n(data.library.borrowings)} hint={t('reading_club.stats.borrowers', { count: data.library.borrowers })} />
        <Tile label={t('reading_club.stats.overdue_now')} value={n(data.library.overdueNow)} />
        <Tile label={t('reading_club.stats.club_members')} value={club ? n(club.members) : '—'} hint={club?.episode.name} />
        <Tile label={t('reading_club.stats.achievements')} value={club ? n(club.completions) : '—'} hint={club ? t('reading_club.stats.pending_rewards', { count: club.pendingRewards }) : undefined} />
        <Tile label={t('reading_club.stats.presents')} value={club ? n(club.presents) : '—'} />
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'stretch' }}>
        <Box sx={{ flex: 1 }}>
          <Section title={t('reading_club.stats.top_readers_club')} hint={t('reading_club.stats.top_readers_club_hint')}>
            <SimpleTable
              head={[t('reading_club.stats.reader'), t('reading_club.stats.group'), t('reading_club.stats.stages_done'), t('reading_club.stats.books_read')]}
              rows={(club?.topReaders ?? []).map((r) => [`${r.name} (${r.code})`, r.groupName ?? '—', n(r.completions), n(r.booksRead)])}
            />
          </Section>
        </Box>
        <Box sx={{ flex: 1 }}>
          <Section title={t('reading_club.stats.top_readers_library')} hint={t('reading_club.stats.top_readers_library_hint')}>
            <SimpleTable
              head={[t('reading_club.stats.reader'), t('reading_club.stats.class'), t('reading_club.stats.borrowings')]}
              rows={data.library.topReaders.map((r) => [`${r.name} (${r.code})`, r.className ?? '—', n(r.borrowings)])}
            />
          </Section>
        </Box>
      </Stack>

      {club && club.completionsByMonth.length > 0 ? (
        <Section title={t('reading_club.stats.achievements_by_month')}>
          <Bars items={club.completionsByMonth.map((m) => ({ key: m.month, count: m.count }))} n={n} limit={36} />
        </Section>
      ) : null}
      {!club ? <Alert severity="info">{t('reading_club.stats.no_episode')}</Alert> : null}
    </>
  );
}

function Groups({ data, n }: { data: ClubStatistics; n: N }) {
  const { t } = useTranslation();
  if (!data.club) return <Alert severity="info">{t('reading_club.stats.no_episode')}</Alert>;
  if (data.club.groups.length === 0) return <Alert severity="info">{t('reading_club.stats.no_groups')}</Alert>;
  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 760 }}>
        {t('reading_club.stats.groups_help')}
      </Typography>
      {data.club.groups.map((g) => (
        <GroupCard key={g.id} group={g} n={n} />
      ))}
    </>
  );
}

function GroupCard({ group, n }: { group: StatsGroup; n: N }) {
  const { t } = useTranslation();
  const pct = (v: number | null) => (v === null ? '—' : `${n(v)}%`);
  return (
    <Section title={group.name}>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
        <Chip size="small" label={t('reading_club.stats.members_count', { count: group.members })} />
        <Chip size="small" color="success" label={t('reading_club.stats.completions_count', { count: group.completions })} />
      </Stack>
      <SimpleTable
        head={[
          t('reading_club.stats.stage'),
          t('reading_club.stats.target'),
          t('reading_club.stats.readers_now'),
          t('reading_club.stats.avg_progress'),
          t('reading_club.stats.avg_days'),
          t('reading_club.stats.completed'),
          t('reading_club.stats.completion_rate'),
          t('reading_club.stats.read_here'),
        ]}
        rows={group.stages.map((s) => [
          `${n(s.order)}. ${s.name}`,
          `${n(s.targetAmount)} ${t(s.targetType === 'books' ? 'reading_club.stats.unit_books' : 'reading_club.stats.unit_pages')}`,
          n(s.readersNow),
          pct(s.avgProgressPct),
          s.avgDaysInStage === null ? '—' : n(s.avgDaysInStage),
          n(s.completed),
          pct(s.completionRate),
          <Chips key="c" items={s.categories} n={n} limit={3} />,
        ])}
      />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ mt: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" gutterBottom>
            {t('reading_club.stats.categories_in_group')}
          </Typography>
          <Bars items={group.categories} n={n} limit={6} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" gutterBottom>
            {t('reading_club.stats.levels_in_group')}
          </Typography>
          <Bars items={group.levels} n={n} limit={6} />
        </Box>
      </Stack>
    </Section>
  );
}

function Books({ data, n }: { data: ClubStatistics; n: N }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  return (
    <>
      <Section title={t('reading_club.stats.top_rated')} hint={t('reading_club.stats.top_rated_hint')}>
        <SimpleTable
          head={[t('reading_club.stats.book'), t('reading_club.stats.author'), t('reading_club.stats.category'), t('reading_club.stats.level'), t('reading_club.stats.rating'), t('reading_club.stats.ratings_count')]}
          rows={data.topRated.map((b) => [b.title, b.author ?? '—', b.category ?? '—', b.readingLevel ?? '—', formatNumber(b.average, language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), n(b.ratings)])}
        />
      </Section>
      <Section title={t('reading_club.stats.most_borrowed')}>
        <SimpleTable
          head={[t('reading_club.stats.book'), t('reading_club.stats.author'), t('reading_club.stats.category'), t('reading_club.stats.borrowings')]}
          rows={data.library.topBooks.map((b) => [b.title, b.author ?? '—', b.category ?? '—', n(b.count)])}
        />
      </Section>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Box sx={{ flex: 1 }}>
          <Section title={t('reading_club.stats.categories_borrowed')} hint={t('reading_club.stats.focus_hint')}>
            <Bars items={data.library.categories} n={n} limit={12} />
          </Section>
        </Box>
        <Box sx={{ flex: 1 }}>
          <Section title={t('reading_club.stats.levels_borrowed')}>
            <Bars items={data.library.levels} n={n} limit={12} />
          </Section>
        </Box>
      </Stack>
      {data.club ? (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <Box sx={{ flex: 1 }}>
            <Section title={t('reading_club.stats.categories_club')}>
              <Bars items={data.club.categories} n={n} limit={12} />
            </Section>
          </Box>
          <Box sx={{ flex: 1 }}>
            <Section title={t('reading_club.stats.levels_club')}>
              <Bars items={data.club.levels} n={n} limit={12} />
            </Section>
          </Box>
        </Stack>
      ) : null}
    </>
  );
}

function AgeGroups({ data, n }: { data: ClubStatistics; n: N }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const bands = data.byAge.bands;
  const categories = [...new Map(bands.flatMap((b) => b.categories).map((c) => [c.key, c.key])).keys()].slice(0, 8);
  const label = (b: StatsAgeBand) => b.label ?? t('reading_club.stats.age_unknown');
  const max = Math.max(1, ...bands.flatMap((b) => b.categories.map((c) => c.count)));
  return (
    <>
      {data.readers.withoutDateOfBirth > 0 ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('reading_club.stats.missing_dob', { count: data.readers.withoutDateOfBirth })}
        </Alert>
      ) : null}
      <Section title={t('reading_club.stats.age_overview')} hint={t('reading_club.stats.age_hint')}>
        <SimpleTable
          head={[t('reading_club.stats.age_group'), t('reading_club.stats.readers'), t('reading_club.stats.borrowings'), t('reading_club.stats.top_categories'), t('reading_club.stats.top_books')]}
          rows={bands.map((b) => [
            label(b),
            n(b.readers),
            n(b.borrowings),
            <Chips key="c" items={b.categories} n={n} limit={3} />,
            b.topBooks.length ? b.topBooks.map((x) => `${x.title} (${n(x.count)})`).join(' · ') : '—',
          ])}
        />
      </Section>
      {categories.length > 0 ? (
        <Section title={t('reading_club.stats.age_matrix')} hint={t('reading_club.stats.age_matrix_hint')}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('reading_club.stats.age_group')}</TableCell>
                  {categories.map((c) => (
                    <TableCell key={c ?? '__none'} align="center">
                      {c ?? t('reading_club.stats.unspecified')}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {bands.map((b) => (
                  <TableRow key={b.label ?? '__unknown'}>
                    <TableCell>{label(b)}</TableCell>
                    {categories.map((c) => {
                      const count = b.categories.find((x) => x.key === c)?.count ?? 0;
                      return (
                        <TableCell key={c ?? '__none'} align="center" sx={{ bgcolor: count ? alpha(theme.palette.primary.main, 0.12 + 0.6 * (count / max)) : undefined }}>
                          {count ? n(count) : ''}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Section>
      ) : null}
      <Section title={t('reading_club.stats.age_levels')}>
        <SimpleTable head={[t('reading_club.stats.age_group'), t('reading_club.stats.levels_borrowed')]} rows={bands.map((b) => [label(b), <Chips key="l" items={b.levels} n={n} limit={5} />])} />
      </Section>
    </>
  );
}
