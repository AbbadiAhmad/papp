import { Box, Card, CardContent, Grid, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { libraryCirculationApi } from '../api';

/** §18's dashboard cards — real aggregate counts from GET /dashboard, never mock data. */
export function DashboardPage() {
  const { t } = useTranslation();
  const { status, data, errorMessage, reload } = useGuardedQuery(() =>
    libraryCirculationApi.getDashboardStats(),
  );

  const cards = data
    ? [
        { label: t('library_circulation.dashboard.students'), value: data.students, color: 'text.primary' },
        { label: t('library_circulation.dashboard.total_copies'), value: data.totalCopies, color: 'text.primary' },
        { label: t('library_circulation.dashboard.available_copies'), value: data.availableCopies, color: 'success.main' },
        { label: t('library_circulation.dashboard.borrowed_copies'), value: data.borrowedCopies, color: 'text.primary' },
        { label: t('library_circulation.dashboard.overdue_borrowings'), value: data.overdueBorrowings, color: 'error.main' },
        { label: t('library_circulation.dashboard.unpaid_fines'), value: data.unpaidFinesTotal.toFixed(2), color: 'error.main' },
        { label: t('library_circulation.dashboard.paid_fines'), value: data.paidFinesTotal.toFixed(2), color: 'success.main' },
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
                <CardContent>
                  <Typography variant="body2" color="text.secondary">
                    {card.label}
                  </Typography>
                  <Typography variant="h4" sx={{ color: card.color, mt: 1 }}>
                    {card.value}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </QueryStateGate>
    </Box>
  );
}
