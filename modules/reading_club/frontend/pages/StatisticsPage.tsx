import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, MenuItem, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { StatBars, StatChips, StatSection, StatTable, StatTile, type FormatCount } from '../../../../apps/web/src/shared/components/StatsBlocks';
import { formatNumber } from '../../../../apps/web/src/shared/format';
import { readingClubApi, type ClubStatistics, type StatisticsQuery, type StatsGroup } from '../api';
import { EpisodeSwitcher } from './EpisodeSwitcher';

type TabKey = 'overview' | 'groups' | 'readers' | 'books' | 'age';

/**
 * Club statistics: is each stage/level suitable, who is progressing and who
 * is stuck, what the club readers read, how seasons compare. The general
 * library numbers (most borrowed / best rated books, overdue, fines...) are
 * on library_circulation's own statistics page. Computed server-side.
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
  const n: FormatCount = (value) => formatNumber(value, language);

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
        data.episode === null ? (
          <Alert severity="info">{t('reading_club.stats.no_episode')}</Alert>
        ) : (
          <>
            <Tabs value={tab} onChange={(_e, v: TabKey) => setTab(v)} sx={{ mb: 2 }} variant="scrollable" scrollButtons="auto">
              <Tab value="overview" label={t('reading_club.stats.tab_overview')} />
              <Tab value="groups" label={t('reading_club.stats.tab_groups')} />
              <Tab value="readers" label={t('reading_club.stats.tab_readers')} />
              <Tab value="books" label={t('reading_club.stats.tab_books')} />
              <Tab value="age" label={t('reading_club.stats.tab_age')} />
            </Tabs>
            <Box sx={{ opacity: loading ? 0.5 : 1 }}>
              {tab === 'overview' ? <Overview data={data} n={n} /> : null}
              {tab === 'groups' ? <Groups data={data} n={n} /> : null}
              {tab === 'readers' ? <Readers data={data} n={n} /> : null}
              {tab === 'books' ? <ClubBooks data={data} n={n} /> : null}
              {tab === 'age' ? <AgeAndSeasons data={data} n={n} /> : null}
            </Box>
          </>
        )
      ) : null}
    </Box>
  );
}

const pctText = (v: number | null, n: FormatCount) => (v === null ? '—' : `${n(v)}%`);
const numText = (v: number | null, n: FormatCount) => (v === null ? '—' : n(v));

function Overview({ data, n }: { data: ClubStatistics; n: FormatCount }) {
  const { t } = useTranslation();
  const { participation: p, achievements: a, rewards: r } = data;
  return (
    <>
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2, mb: 2 }}>
        <StatTile label={t('reading_club.stats.club_members')} value={n(p.members)} hint={data.episode?.name} />
        <StatTile label={t('reading_club.stats.participation')} value={pctText(p.participationPct, n)} hint={t('reading_club.stats.of_active_readers', { count: p.activeReaders })} />
        <StatTile label={t('reading_club.stats.achievements')} value={n(a.completions)} />
        <StatTile label={t('reading_club.stats.finished_all')} value={n(p.finishedAllStages)} />
        <StatTile label={t('reading_club.stats.presents')} value={n(a.presents)} />
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Box sx={{ flex: 1 }}>
          <StatSection title={t('reading_club.stats.club_effect')} hint={t('reading_club.stats.club_effect_hint')}>
            <StatTable
              head={[t('reading_club.stats.who'), t('reading_club.stats.borrowings_per_reader')]}
              rows={[
                [t('reading_club.stats.members'), numText(p.borrowingsPerMember, n)],
                [t('reading_club.stats.non_members'), numText(p.borrowingsPerNonMember, n)],
              ]}
            />
          </StatSection>
        </Box>
        <Box sx={{ flex: 1 }}>
          <StatSection title={t('reading_club.stats.rewards')} hint={t('reading_club.stats.rewards_hint')}>
            <StatTable
              head={[t('reading_club.stats.measure'), t('reading_club.stats.value')]}
              rows={[
                [t('reading_club.stats.rewards_pending'), n(r.pending)],
                [t('reading_club.stats.oldest_pending_days'), numText(r.oldestPendingDays, n)],
                [t('reading_club.stats.avg_days_to_deliver'), numText(r.avgDaysToDeliver, n)],
              ]}
            />
          </StatSection>
        </Box>
      </Stack>

      {a.completionsByMonth.length > 0 ? (
        <StatSection title={t('reading_club.stats.achievements_by_month')}>
          <StatBars items={a.completionsByMonth.map((m) => ({ key: m.month, count: m.count }))} n={n} limit={36} />
        </StatSection>
      ) : null}
    </>
  );
}

function Groups({ data, n }: { data: ClubStatistics; n: FormatCount }) {
  const { t } = useTranslation();
  if (data.groups.length === 0) return <Alert severity="info">{t('reading_club.stats.no_groups')}</Alert>;
  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 760 }}>
        {t('reading_club.stats.groups_help')}
      </Typography>
      {data.groups.map((g) => (
        <GroupCard key={g.id} group={g} n={n} />
      ))}
    </>
  );
}

function GroupCard({ group, n }: { group: StatsGroup; n: FormatCount }) {
  const { t } = useTranslation();
  return (
    <StatSection title={group.name}>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
        <Chip size="small" label={t('reading_club.stats.members_count', { count: group.members })} />
        <Chip size="small" color="success" label={t('reading_club.stats.completions_count', { count: group.completions })} />
      </Stack>
      <StatTable
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
          pctText(s.avgProgressPct, n),
          numText(s.avgDaysInStage, n),
          n(s.completed),
          pctText(s.completionRate, n),
          <StatChips key="c" items={s.categories} n={n} limit={3} />,
        ])}
      />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ mt: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" gutterBottom>
            {t('reading_club.stats.categories_in_group')}
          </Typography>
          <StatBars items={group.categories} n={n} limit={6} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" gutterBottom>
            {t('reading_club.stats.levels_in_group')}
          </Typography>
          <StatBars items={group.levels} n={n} limit={6} />
        </Box>
      </Stack>
    </StatSection>
  );
}

function Readers({ data, n }: { data: ClubStatistics; n: FormatCount }) {
  const { t } = useTranslation();
  return (
    <>
      <StatSection title={t('reading_club.stats.top_readers_club')} hint={t('reading_club.stats.top_readers_club_hint')}>
        <StatTable
          head={[t('reading_club.stats.reader'), t('reading_club.stats.group'), t('reading_club.stats.stages_done'), t('reading_club.stats.books_read')]}
          rows={data.topReaders.map((r) => [`${r.name} (${r.code})`, r.groupName ?? '—', n(r.completions), n(r.booksRead)])}
        />
      </StatSection>
      <StatSection title={t('reading_club.stats.stalled')} hint={t('reading_club.stats.stalled_hint')}>
        <StatTable
          head={[t('reading_club.stats.reader'), t('reading_club.stats.group'), t('reading_club.stats.stage'), t('reading_club.stats.days_in_stage'), t('reading_club.stats.progress')]}
          rows={data.stalled.map((r) => [`${r.name} (${r.code})`, r.groupName ?? '—', r.stageName ?? '—', n(r.daysInStage), pctText(r.progressPct, n)])}
        />
      </StatSection>
    </>
  );
}

function ClubBooks({ data, n }: { data: ClubStatistics; n: FormatCount }) {
  const { t } = useTranslation();
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
      <Box sx={{ flex: 1 }}>
        <StatSection title={t('reading_club.stats.categories_club')} hint={t('reading_club.stats.categories_club_hint')}>
          <StatBars items={data.categories} n={n} limit={12} />
        </StatSection>
      </Box>
      <Box sx={{ flex: 1 }}>
        <StatSection title={t('reading_club.stats.levels_club')}>
          <StatBars items={data.levels} n={n} limit={12} />
        </StatSection>
      </Box>
    </Stack>
  );
}

function AgeAndSeasons({ data, n }: { data: ClubStatistics; n: FormatCount }) {
  const { t } = useTranslation();
  return (
    <>
      <StatSection title={t('reading_club.stats.age_in_club')} hint={t('reading_club.stats.age_hint')}>
        <StatTable
          head={[t('reading_club.stats.age_group'), t('reading_club.stats.club_members'), t('reading_club.stats.achievements'), t('reading_club.stats.top_categories')]}
          rows={data.byAge.bands.map((b) => [b.label ?? t('reading_club.stats.age_unknown'), n(b.members), n(b.completions), <StatChips key="c" items={b.categories} n={n} limit={3} />])}
        />
      </StatSection>
      <StatSection title={t('reading_club.stats.seasons')} hint={t('reading_club.stats.seasons_hint')}>
        <StatTable
          head={[t('reading_club.stats.season'), t('reading_club.stats.groups'), t('reading_club.stats.achievements'), t('reading_club.stats.readers_with_stage')]}
          rows={data.episodes.map((e) => [e.isCurrent ? `${e.name} (${t('reading_club.episodes.current')})` : e.name, n(e.groups), n(e.completions), n(e.readersWithCompletion)])}
        />
      </StatSection>
    </>
  );
}
