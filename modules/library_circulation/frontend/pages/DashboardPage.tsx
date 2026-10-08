import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { CardGrid, PageHero, StatTile, type Tone } from '../../../../apps/web/src/shared/ui/kit';
import { libraryCirculationApi } from '../api';

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
    </Box>
  );
}
