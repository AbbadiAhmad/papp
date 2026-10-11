import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { CardGrid, PageHero, StatTile, StatusPill, type Tone } from '../../../../apps/web/src/shared/ui/kit';
import { libraryCirculationApi, type OverdueResult, type OverdueSortBy } from '../api';
import { ReaderLink } from './ReaderLink';

/**
 * §18's dashboard cards — real aggregate counts from GET /dashboard, never
 * mock data. Bug fix (user-reported): cards now link to the detail page
 * that shows what they're counting, pre-filtered the same way the card's
 * own number was computed (same "click a stat, land on it filtered" pattern
 * reading_club's own DashboardPage already uses for its group/stage cards).
 *
 * `borrowedCopies`/`overdueBorrowings` now link to the new Borrowings
 * status page (LIBRARY_CIRCULATION-D34 — closes the gap LIBRARY_CIRCULATION-
 * D32 originally flagged, "no borrowings list page exists in this module to
 * link to"). `totalCopies`/`availableCopies` still link nowhere — copy-level
 * data lives in the `library_catalog` module's Books list, which filters by
 * BOOK, not by copy status, so it still isn't a real match; left flagged,
 * not guessed at.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [overdue, setOverdue] = useState<OverdueResult | null>(null);
  const [sortBy, setSortBy] = useState<OverdueSortBy>('daysOverdue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1); // 1-based, like the API
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    let cancelled = false;
    libraryCirculationApi
      .getOverdueBorrowings({ sortBy, sortDir, page, pageSize })
      .then((r) => {
        if (cancelled) return;
        const lastPage = Math.max(1, Math.ceil(r.total / pageSize));
        if (page > lastPage) setPage(lastPage);
        else setOverdue(r);
      })
      .catch(() => {
        if (!cancelled) setOverdue({ items: [], total: 0, page, pageSize });
      });
    return () => {
      cancelled = true;
    };
  }, [sortBy, sortDir, page, pageSize]);

  const toggleSort = (column: OverdueSortBy) => {
    if (sortBy === column) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(column);
      setSortDir('asc');
    }
    setPage(1);
  };
  const sortHeader = (column: OverdueSortBy, label: string) => (
    <TableSortLabel active={sortBy === column} direction={sortBy === column ? sortDir : 'asc'} onClick={() => toggleSort(column)}>
      {label}
    </TableSortLabel>
  );
  const { status, data, errorMessage, reload } = useGuardedQuery(() =>
    libraryCirculationApi.getDashboardStats(),
  );

  const cards = data
    ? [
        { label: t('library_circulation.dashboard.students'), value: data.students, tone: 'neutral' as Tone, to: '/library-circulation/readers' },
        { label: t('library_circulation.dashboard.total_copies'), value: data.totalCopies, tone: 'neutral' as Tone, to: null },
        { label: t('library_circulation.dashboard.available_copies'), value: data.availableCopies, tone: 'success' as Tone, to: null },
        {
          label: t('library_circulation.dashboard.borrowed_copies'),
          value: data.borrowedCopies,
          tone: 'neutral' as Tone,
          to: '/library-circulation/borrowings?status=active',
        },
        {
          label: t('library_circulation.dashboard.overdue_borrowings'),
          value: data.overdueBorrowings,
          tone: 'error' as Tone,
          to: '/library-circulation/borrowings?overdueOnly=true',
        },
        {
          label: t('library_circulation.dashboard.unpaid_fines'),
          value: data.unpaidFinesTotal.toFixed(2),
          tone: 'error' as Tone,
          to: '/library-circulation/fines?status=unpaid,partially_paid',
        },
        {
          label: t('library_circulation.dashboard.paid_fines'),
          value: data.paidFinesTotal.toFixed(2),
          tone: 'success' as Tone,
          to: '/library-circulation/fines?status=paid',
        },
      ]
    : [];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <PageHero title={t('library_circulation.menu.dashboard')} subtitle={t('library_circulation.dashboard.subtitle')} />
      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <CardGrid min={200}>
          {cards.map((card) => (
            <StatTile key={card.label} label={card.label} value={card.value} tone={card.tone} to={card.to} />
          ))}
        </CardGrid>
      </QueryStateGate>

      <Typography variant="h6" component="h2">
        {t('library_circulation.dashboard.overdue_title')}
      </Typography>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{sortHeader('studentName', t('library_circulation.reader_picker.label'))}</TableCell>
              <TableCell>{sortHeader('bookTitle', t('library_circulation.borrowings.book_title'))}</TableCell>
              <TableCell>{sortHeader('borrowedAt', t('library_circulation.borrowings.borrowed_at'))}</TableCell>
              <TableCell>{sortHeader('dueAt', t('library_circulation.borrowings.due_at'))}</TableCell>
              <TableCell>{sortHeader('daysOverdue', t('library_circulation.borrowings.days_overdue'))}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(overdue?.items ?? []).map((row) => (
              <TableRow key={row.id} hover>
                <TableCell>
                  <ReaderLink readerId={row.studentId} name={row.studentName} code={row.studentCode} />
                </TableCell>
                <TableCell>{row.bookTitle ?? row.qrCode ?? '—'}</TableCell>
                <TableCell>{formatDateOnly(row.borrowedAt, language)}</TableCell>
                <TableCell>{formatDateOnly(row.dueAt, language)}</TableCell>
                <TableCell>
                  <StatusPill tone="error" label={row.daysOverdue} />
                </TableCell>
              </TableRow>
            ))}
            {overdue && overdue.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>{t('library_circulation.dashboard.overdue_empty')}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={overdue?.total ?? 0}
          page={page - 1}
          onPageChange={(_e, newPage) => setPage(newPage + 1)}
          rowsPerPage={pageSize}
          rowsPerPageOptions={[10, 25, 50]}
          onRowsPerPageChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
          labelRowsPerPage={t('library_circulation.students.rows_per_page')}
          labelDisplayedRows={({ from, to, count }) => t('library_circulation.students.displayed_rows', { from, to, count })}
        />
      </TableContainer>
    </Box>
  );
}
