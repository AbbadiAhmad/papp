import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <Box sx={{ maxWidth: 480, mx: 'auto', mt: 8, textAlign: 'center' }}>
      <Typography variant="h4" component="h2" gutterBottom>
        404
      </Typography>
      <Typography variant="body1">{t('core.not_found.body')}</Typography>
    </Box>
  );
}
