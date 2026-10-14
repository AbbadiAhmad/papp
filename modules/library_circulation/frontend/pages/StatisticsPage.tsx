import { Alert, Box, Button, Card, CardContent, CircularProgress, MenuItem, Stack, Tab, Tabs, TextField, Typography, alpha, useTheme } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { StatBars, StatChips, StatSection, StatTable, StatTile, type FormatCount } from '../../../../apps/web/src/shared/components/StatsBlocks';
import { formatNumber } from '../../../../apps/web/src/shared/format';
import { libraryCirculationApi, type LibraryStatisticsData, type LibraryStatisticsQuery } from '../api';

type TabKey = 'overview' | 'books' | 'readers' | 'overdue' | 'age';

const pctText = (v: number | null, n: FormatCount) => (v === null ? '—' : `${n(v)}%`);
const numText = (v: number | null, n: FormatCount) => (v === null ? '—' : n(v));

/**
 * Library statistics for the librarian / administrator: how the collection is
 * used, who reads, what is overdue, fines, and what each age group borrows —
 * to decide purchases, promotion and follow-up. The reading-club numbers
 * (stages, groups) are on the reading_club module's own statistics page.
 */
export function StatisticsPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [tab, setTab] = useState<TabKey>('overview');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [bandYears, setBandYears] = useState(2);
  const [applied, setApplied] = useState<LibraryStatisticsQuery>({ ageBandYears: 2 });
  const [data, setData] = useState<LibraryStatisticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    libraryCirculationApi
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

  const n: FormatCount = (value) => formatNumber(value, language);
  const apply = () => setApplied({ from: from || undefined, to: to || undefined, ageBandYears: bandYears });

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('library_circulation.stats.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 760 }}>
        {t('library_circulation.stats.subtitle')}
      </Typography>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 2 }}>
            <TextField type="date" size="small" label={t('library_circulation.stats.from')} value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField type="date" size="small" label={t('library_circulation.stats.to')} value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField select size="small" label={t('library_circulation.stats.age_band')} value={bandYears} onChange={(e) => setBandYears(Number(e.target.value))} sx={{ minWidth: 150 }}>
              {[1, 2, 3, 5].map((y) => (
                <MenuItem key={y} value={y}>
                  {t('library_circulation.stats.age_band_years', { count: y })}
                </MenuItem>
              ))}
            </TextField>
            <Button variant="contained" onClick={apply} disabled={loading}>
              {t('library_circulation.stats.apply')}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
            {t('library_circulation.stats.period_hint')}
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
            <Tab value="overview" label={t('library_circulation.stats.tab_overview')} />
            <Tab value="books" label={t('library_circulation.stats.tab_books')} />
            <Tab value="readers" label={t('library_circulation.stats.tab_readers')} />
            <Tab value="overdue" label={t('library_circulation.stats.tab_overdue')} />
            <Tab value="age" label={t('library_circulation.stats.tab_age')} />
          </Tabs>
          <Box sx={{ opacity: loading ? 0.5 : 1 }}>
            {tab === 'overview' ? <Overview data={data} n={n} /> : null}
            {tab === 'books' ? <Books data={data} n={n} /> : null}
            {tab === 'readers' ? <ReadersTab data={data} n={n} /> : null}
            {tab === 'overdue' ? <OverdueAndFines data={data} n={n} /> : null}
            {tab === 'age' ? <AgeGroups data={data} n={n} /> : null}
          </Box>
        </>
      ) : null}
    </Box>
  );
}

function Overview({ data, n }: { data: LibraryStatisticsData; n: FormatCount }) {
  const { t } = useTranslation();
  const { readers, collection, activity } = data;
  const statusLabel = (key: string | null) => (key ? t(`library_circulation.stats.copy_status_${key}`, { defaultValue: key }) : null);
  return (
    <>
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2, mb: 2 }}>
        <StatTile label={t('library_circulation.stats.readers')} value={n(readers.total)} hint={t('library_circulation.stats.readers_active', { count: readers.active })} />
        <StatTile label={t('library_circulation.stats.borrowings')} value={n(activity.borrowings)} hint={t('library_circulation.stats.borrowers', { count: activity.borrowers })} />
        <StatTile label={t('library_circulation.stats.returns')} value={n(activity.returns)} />
        <StatTile label={t('library_circulation.stats.on_loan_now')} value={n(activity.onLoanNow)} />
        <StatTile label={t('library_circulation.stats.overdue_now')} value={n(activity.overdueNow)} />
        <StatTile label={t('library_circulation.stats.collection')} value={n(collection.titles)} hint={t('library_circulation.stats.copies_count', { count: collection.copies })} />
      </Stack>
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2, mb: 2 }}>
        <StatTile label={t('library_circulation.stats.borrower_rate')} value={pctText(activity.borrowerRatePct, n)} hint={t('library_circulation.stats.borrower_rate_hint')} />
        <StatTile label={t('library_circulation.stats.avg_loan_days')} value={numText(activity.avgLoanDays, n)} />
        <StatTile label={t('library_circulation.stats.on_time_rate')} value={pctText(activity.onTimeRatePct, n)} hint={t('library_circulation.stats.on_time_rate_hint')} />
        <StatTile label={t('library_circulation.stats.avg_days_late')} value={numText(activity.avgDaysLate, n)} />
        <StatTile label={t('library_circulation.stats.new_readers')} value={n(readers.newInPeriod)} hint={t('library_circulation.stats.new_titles', { count: collection.newTitles })} />
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Box sx={{ flex: 2 }}>
          <StatSection title={t('library_circulation.stats.by_month')}>
            <StatBars items={activity.byMonth.map((m) => ({ key: m.month, count: m.count }))} n={n} limit={36} />
          </StatSection>
        </Box>
        <Box sx={{ flex: 1 }}>
          <StatSection title={t('library_circulation.stats.by_weekday')} hint={t('library_circulation.stats.by_weekday_hint')}>
            <StatBars items={activity.byWeekday.map((w) => ({ key: t(`library_circulation.stats.weekday_${w.weekday}`), count: w.count }))} n={n} limit={7} />
          </StatSection>
        </Box>
      </Stack>
      <StatSection title={t('library_circulation.stats.copies_by_status')}>
        <StatBars items={collection.copiesByStatus.map((c) => ({ key: statusLabel(c.key), count: c.count }))} n={n} />
      </StatSection>
    </>
  );
}

function Books({ data, n }: { data: LibraryStatisticsData; n: FormatCount }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { books, collection } = data;
  return (
    <>
      <StatSection title={t('library_circulation.stats.top_rated')} hint={t('library_circulation.stats.top_rated_hint')}>
        <StatTable
          head={[t('library_circulation.stats.book'), t('library_circulation.stats.author'), t('library_circulation.stats.category'), t('library_circulation.stats.level'), t('library_circulation.stats.rating'), t('library_circulation.stats.ratings_count')]}
          rows={books.topRated.map((b) => [b.title, b.author ?? '—', b.category ?? '—', b.readingLevel ?? '—', formatNumber(b.average, language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), n(b.ratings)])}
        />
      </StatSection>
      <StatSection title={t('library_circulation.stats.most_borrowed')}>
        <StatTable
          head={[t('library_circulation.stats.book'), t('library_circulation.stats.author'), t('library_circulation.stats.category'), t('library_circulation.stats.borrowings')]}
          rows={books.topBooks.map((b) => [b.title, b.author ?? '—', b.category ?? '—', n(b.count)])}
        />
      </StatSection>
      <StatSection title={t('library_circulation.stats.high_demand')} hint={t('library_circulation.stats.high_demand_hint')}>
        <StatTable
          head={[t('library_circulation.stats.book'), t('library_circulation.stats.category'), t('library_circulation.stats.borrowings'), t('library_circulation.stats.copies'), t('library_circulation.stats.per_copy')]}
          rows={books.highDemand.map((b) => [b.title, b.category ?? '—', n(b.borrowings), n(b.copies), n(b.perCopy)])}
        />
      </StatSection>
      <StatSection title={t('library_circulation.stats.never_borrowed', { count: collection.neverBorrowed.count })} hint={t('library_circulation.stats.never_borrowed_hint')}>
        <StatTable
          head={[t('library_circulation.stats.book'), t('library_circulation.stats.author'), t('library_circulation.stats.category'), t('library_circulation.stats.copies')]}
          rows={collection.neverBorrowed.sample.map((b) => [b.title, b.author ?? '—', b.category ?? '—', n(b.copies)])}
        />
      </StatSection>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Box sx={{ flex: 1 }}>
          <StatSection title={t('library_circulation.stats.categories_borrowed')} hint={t('library_circulation.stats.focus_hint')}>
            <StatBars items={books.categories} n={n} limit={12} />
          </StatSection>
        </Box>
        <Box sx={{ flex: 1 }}>
          <StatSection title={t('library_circulation.stats.levels_borrowed')}>
            <StatBars items={books.levels} n={n} limit={12} />
          </StatSection>
        </Box>
      </Stack>
    </>
  );
}

function ReadersTab({ data, n }: { data: LibraryStatisticsData; n: FormatCount }) {
  const { t } = useTranslation();
  const { readersActivity: r } = data;
  return (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Box sx={{ flex: 1 }}>
          <StatSection title={t('library_circulation.stats.top_borrowers')}>
            <StatTable
              head={[t('library_circulation.stats.reader'), t('library_circulation.stats.class'), t('library_circulation.stats.borrowings')]}
              rows={r.topReaders.map((x) => [`${x.name} (${x.code})`, x.className ?? '—', n(x.borrowings)])}
            />
          </StatSection>
        </Box>
        <Box sx={{ flex: 1 }}>
          <StatSection title={t('library_circulation.stats.inactive_readers', { count: r.inactive.count })} hint={t('library_circulation.stats.inactive_hint')}>
            <StatTable head={[t('library_circulation.stats.reader'), t('library_circulation.stats.class')]} rows={r.inactive.sample.map((x) => [`${x.name} (${x.code})`, x.className ?? '—'])} />
          </StatSection>
        </Box>
      </Stack>
      <StatSection title={t('library_circulation.stats.by_class')} hint={t('library_circulation.stats.by_class_hint')}>
        <StatTable
          head={[t('library_circulation.stats.class'), t('library_circulation.stats.readers'), t('library_circulation.stats.borrowings'), t('library_circulation.stats.per_reader')]}
          rows={r.byClass.map((c) => [c.className ?? t('core.stats.unspecified'), n(c.readers), n(c.borrowings), n(c.perReader)])}
        />
      </StatSection>
    </>
  );
}

function OverdueAndFines({ data, n }: { data: LibraryStatisticsData; n: FormatCount }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { overdue, fines, returnConditions } = data;
  const money = (v: number) => formatNumber(v, language, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const conditionLabel = (key: string | null) => t(`library_circulation.return.status_${key ?? 'returned'}`, { defaultValue: key ?? '' });
  const fineStatusLabel = (key: string | null) => (key ? t(`library_circulation.fine_status.${key}`, { defaultValue: key }) : null);
  return (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Box sx={{ flex: 1 }}>
          <StatSection title={t('library_circulation.stats.overdue_by_age')} hint={t('library_circulation.stats.overdue_by_age_hint')}>
            <StatBars items={overdue.buckets} n={n} />
          </StatSection>
        </Box>
        <Box sx={{ flex: 1 }}>
          <StatSection title={t('library_circulation.stats.return_conditions')} hint={t('library_circulation.stats.return_conditions_hint')}>
            <StatBars items={returnConditions.map((c) => ({ key: conditionLabel(c.key), count: c.count }))} n={n} />
          </StatSection>
        </Box>
      </Stack>
      <StatSection title={t('library_circulation.stats.overdue_readers')}>
        <StatTable
          head={[t('library_circulation.stats.reader'), t('library_circulation.stats.class'), t('library_circulation.stats.books_overdue'), t('library_circulation.stats.max_days_late')]}
          rows={overdue.readers.map((x) => [`${x.name} (${x.code})`, x.className ?? '—', n(x.books), n(x.maxDaysLate)])}
        />
      </StatSection>

      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 2, mb: 2 }}>
        <StatTile label={t('library_circulation.stats.fines_issued')} value={n(fines.issuedCount)} hint={money(fines.issuedAmount)} />
        <StatTile label={t('library_circulation.stats.fines_paid')} value={money(fines.paidAmount)} />
        <StatTile label={t('library_circulation.stats.fines_outstanding')} value={money(fines.outstandingAmount)} hint={t('library_circulation.stats.fines_outstanding_hint')} />
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Box sx={{ flex: 1 }}>
          <StatSection title={t('library_circulation.stats.fines_by_type')}>
            <StatTable
              head={[t('library_circulation.stats.fine_type'), t('library_circulation.stats.count'), t('library_circulation.stats.amount')]}
              rows={fines.byType.map((x) => [x.name, n(x.count), money(x.amount)])}
            />
          </StatSection>
        </Box>
        <Box sx={{ flex: 1 }}>
          <StatSection title={t('library_circulation.stats.fines_by_status')}>
            <StatBars items={fines.byStatus.map((c) => ({ key: fineStatusLabel(c.key), count: c.count }))} n={n} />
          </StatSection>
        </Box>
      </Stack>
    </>
  );
}

function AgeGroups({ data, n }: { data: LibraryStatisticsData; n: FormatCount }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const bands = data.byAge.bands;
  const categories = [...new Set(bands.flatMap((b) => b.categories).map((c) => c.key))].slice(0, 8);
  const label = (b: (typeof bands)[number]) => b.label ?? t('library_circulation.stats.age_unknown');
  const max = Math.max(1, ...bands.flatMap((b) => b.categories.map((c) => c.count)));
  return (
    <>
      {data.readers.withoutDateOfBirth > 0 ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('library_circulation.stats.missing_dob', { count: data.readers.withoutDateOfBirth })}
        </Alert>
      ) : null}
      <StatSection title={t('library_circulation.stats.age_overview')} hint={t('library_circulation.stats.age_hint')}>
        <StatTable
          head={[t('library_circulation.stats.age_group'), t('library_circulation.stats.readers'), t('library_circulation.stats.borrowings'), t('library_circulation.stats.top_categories'), t('library_circulation.stats.top_books')]}
          rows={bands.map((b) => [label(b), n(b.readers), n(b.borrowings), <StatChips key="c" items={b.categories} n={n} limit={3} />, b.topBooks.length ? b.topBooks.map((x) => `${x.title} (${n(x.count)})`).join(' · ') : '—'])}
        />
      </StatSection>
      {categories.length > 0 ? (
        <StatSection title={t('library_circulation.stats.age_matrix')} hint={t('library_circulation.stats.age_matrix_hint')}>
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'start', padding: 6 }}>{t('library_circulation.stats.age_group')}</th>
                  {categories.map((c) => (
                    <th key={c ?? '__none'} style={{ padding: 6 }}>
                      {c ?? t('core.stats.unspecified')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bands.map((b) => (
                  <tr key={b.label ?? '__unknown'}>
                    <td style={{ padding: 6 }}>{label(b)}</td>
                    {categories.map((c) => {
                      const count = b.categories.find((x) => x.key === c)?.count ?? 0;
                      return (
                        <td key={c ?? '__none'} style={{ padding: 6, textAlign: 'center', background: count ? alpha(theme.palette.primary.main, 0.12 + 0.6 * (count / max)) : undefined }}>
                          {count ? n(count) : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        </StatSection>
      ) : null}
      <StatSection title={t('library_circulation.stats.age_levels')}>
        <StatTable head={[t('library_circulation.stats.age_group'), t('library_circulation.stats.levels_borrowed')]} rows={bands.map((b) => [label(b), <StatChips key="l" items={b.levels} n={n} limit={5} />])} />
      </StatSection>
    </>
  );
}
