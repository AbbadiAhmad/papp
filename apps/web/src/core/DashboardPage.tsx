import { Box, Card, CardContent, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../app/AuthContext';

export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('core.dashboard.welcome', { name: user?.name ?? '' })}
      </Typography>
      <Card sx={{ maxWidth: 480, mt: 2 }}>
        <CardContent>
          <Typography variant="body2" color="text.secondary">
            {t('core.dashboard.hint')}
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
