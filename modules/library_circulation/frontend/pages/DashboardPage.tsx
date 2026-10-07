import { Box, Card, CardActionArea, CardContent, Grid, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
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
  const navigate = useNavigate();
  const { status, data, errorMessage, reload } = useGuardedQuery(() =>
    libraryCirculationApi.getDashboardStats(),
  );

  const cards = data
    ? [
        { label: t('library_circulation.dashboard.students'), value: data.students, color: 'text.primary', to: '/library-circulation/readers' },
        { label: t('library_circulation.dashboard.total_copies'), value: data.totalCopies, color: 'text.primary', to: null },
        { label: t('library_circulation.dashboard.available_copies'), value: data.availableCopies, color: 'success.main', to: null },
        {
          label: t('library_circulation.dashboard.borrowed_copies'),
          value: data.borrowedCopies,
          color: 'text.primary',
          to: '/library-circulation/borrowings?status=active',
        },
        {
          label: t('library_circulation.dashboard.overdue_borrowings'),
          value: data.overdueBorrowings,
          color: 'error.main',
          to: '/library-circulation/borrowings?overdueOnly=true',
        },
        {
          label: t('library_circulation.dashboard.unpaid_fines'),
          value: data.unpaidFinesTotal.toFixed(2),
          color: 'error.main',
          to: '/library-circulation/fines?status=unpaid,partially_paid',
        },
        {
          label: t('library_circulation.dashboard.paid_fines'),
          value: data.paidFinesTotal.toFixed(2),
          color: 'success.main',
          to: '/library-circulation/fines?status=paid',
        },
      ]
    : [];

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('library_circulation.menu.dashboard')}
      </Typography>
      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <Grid container spacing={2}>
          {cards.map((card) => (
            <Grid key={card.label} size={{ xs: 12, sm: 6, md: 3 }}>
              <Card>
                {card.to ? (
                  <CardActionArea onClick={() => navigate(card.to as string)}>
                    <CardContent>
                      <Typography variant="body2" color="text.secondary">
                        {card.label}
                      </Typography>
                      <Typography variant="h4" sx={{ color: card.color, mt: 1 }}>
                        {card.value}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                ) : (
                  <CardContent>
                    <Typography variant="body2" color="text.secondary">
                      {card.label}
                    </Typography>
                    <Typography variant="h4" sx={{ color: card.color, mt: 1 }}>
                      {card.value}
                    </Typography>
                  </CardContent>
                )}
              </Card>
            </Grid>
          ))}
        </Grid>
      </QueryStateGate>
    </Box>
  );
}
