import { Box, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useLanguage } from '../../app/LanguageContext';
import { notificationsApi } from '../../shared/api/notifications';
import { Paginated } from '../../shared/components/Paginated';
import { QueryStateGate } from '../../shared/components/QueryStateGate';
import { formatDateTime } from '../../shared/format';
import { useGuardedQuery } from '../../shared/hooks/useGuardedQuery';

/** Admin evidence view (D119): list of notifications that asked for confirmation, and per-notification detail. */
export function NotificationConfirmationsPage() {
  const { id } = useParams();
  return id ? <ConfirmationDetail id={id} /> : <ConfirmationList />;
}

function ConfirmationList() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { status, data, errorMessage, reload } = useGuardedQuery(() => notificationsApi.listConfirmationRequests());
  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('core.notifications.confirmations.title')}
      </Typography>
      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        {(data ?? []).length === 0 ? (
          <Typography color="text.secondary">{t('core.notifications.confirmations.empty')}</Typography>
        ) : (
          <Paginated items={data ?? []}>
            {(rows) => (
              <Stack spacing={1.5}>
                {rows.map((row) => (
                  <Card key={row.id} variant="outlined">
                    <CardContent>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Box>
                          <Typography variant="subtitle1">{row.title}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatDateTime(row.createdAt, language)} —{' '}
                            {t(`core.notifications.confirmation_types.${row.confirmationType ?? 'receipt'}`, {
                              defaultValue: row.confirmationType ?? '',
                            })}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <Chip
                            size="small"
                            color={row.confirmedCount === row.recipientCount ? 'success' : 'default'}
                            label={t('core.notifications.confirmations.confirmed_count', {
                              confirmed: row.confirmedCount,
                              total: row.recipientCount,
                            })}
                          />
                          <Button component={RouterLink} to={`/notifications/confirmations/${row.id}`} size="small">
                            {t('core.notifications.confirmations.view')}
                          </Button>
                        </Stack>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            )}
          </Paginated>
        )}
      </QueryStateGate>
    </Box>
  );
}

function ConfirmationDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { status, data, errorMessage, reload } = useGuardedQuery(() => notificationsApi.getConfirmations(id));
  const label = (key: string) => t(`core.notifications.confirmations.${key}`);
  return (
    <Box>
      <Button component={RouterLink} to="/notifications/confirmations" sx={{ mb: 1 }}>
        {label('back')}
      </Button>
      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <Typography variant="h4" component="h2" gutterBottom>
          {data?.notification.title}
        </Typography>
        <Typography variant="h6" component="h3" sx={{ mt: 2 }}>
          {label('confirmed')} ({data?.confirmations.length ?? 0})
        </Typography>
        <Paginated items={data?.confirmations ?? []}>
          {(rows) => (
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              {rows.map((c) => (
                <Card key={c.id} variant="outlined">
                  <CardContent>
                    <Typography variant="subtitle1">
                      {c.confirmerName} ({c.confirmerEmail})
                    </Typography>
                    <Typography variant="body2">
                      {label('col_time')}: {formatDateTime(c.confirmedAt, language)} · {label('col_ip')}: {c.ipAddress ?? '—'} ·{' '}
                      {label('col_type')}:{' '}
                      {t(`core.notifications.confirmation_types.${c.confirmationType}`, { defaultValue: c.confirmationType })}
                    </Typography>
                    {c.comment ? (
                      <Typography variant="body2">
                        {label('col_comment')}: {c.comment}
                      </Typography>
                    ) : null}
                    <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                      {label('col_hash')}: {c.contentSha256}
                    </Typography>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}
        </Paginated>
        <Typography variant="h6" component="h3" sx={{ mt: 3 }}>
          {label('pending')} ({data?.pending.length ?? 0})
        </Typography>
        <Paginated items={data?.pending ?? []}>
          {(rows) => (
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              {rows.map((u) => (
                <Typography key={u.id} variant="body2">
                  {u.name} ({u.email})
                </Typography>
              ))}
            </Stack>
          )}
        </Paginated>
      </QueryStateGate>
    </Box>
  );
}
