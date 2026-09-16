import AddIcon from '@mui/icons-material/Add';
import { Box, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { useLanguage } from '../../app/LanguageContext';
import { QueryStateGate } from '../../shared/components/QueryStateGate';
import { formatDateTime } from '../../shared/format';
import { useGuardedQuery } from '../../shared/hooks/useGuardedQuery';
import { notificationsApi } from '../../shared/api/notifications';
import { Can } from '../../shared/permissions';

export function NotificationsInboxPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { status, data, errorMessage, reload } = useGuardedQuery('notifications.view', () => notificationsApi.getInbox());

  const handleMarkRead = async (id: string) => {
    await notificationsApi.markRead(id);
    reload();
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" component="h2">
          {t('core.menu.notifications')}
        </Typography>
        <Can permission="notifications.send">
          <Button startIcon={<AddIcon />} component={RouterLink} to="/notifications/compose" variant="contained">
            {t('core.notifications.compose')}
          </Button>
        </Can>
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <Stack spacing={1.5}>
          {(data?.notifications ?? []).length === 0 ? (
            <Typography color="text.secondary">{t('core.notifications.empty')}</Typography>
          ) : (
            (data?.notifications ?? []).map((item) => (
              <Card key={item.notificationId} variant="outlined">
                <CardContent>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: item.readAt ? 400 : 700 }}>
                        {item.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatDateTime(item.createdAt, language)} — {item.category}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{ mt: 1 }}
                        // Rendered server-side to sanitized HTML (see
                        // NotificationsService.markdown.util — never raw
                        // admin-authored markdown injected unescaped).
                        dangerouslySetInnerHTML={{ __html: item.bodyHtml }}
                      />
                    </Box>
                    {item.readAt ? (
                      <Chip size="small" label={t('core.notifications.read')} />
                    ) : (
                      <Button size="small" onClick={() => handleMarkRead(item.notificationId)}>
                        {t('core.notifications.mark_read')}
                      </Button>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            ))
          )}
        </Stack>
      </QueryStateGate>
    </Box>
  );
}
