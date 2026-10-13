import { Alert, Box, Button, Card, CardContent, Checkbox, FormControlLabel, FormGroup, Snackbar } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { PageHero } from '../../../../apps/web/src/shared/ui/kit';
import { readingClubApi } from '../api';

/** "My club notifications" — each user ticks the club events they want in their inbox (READING_CLUB-D20). */
export function NotificationSubscriptionsPage() {
  const { t } = useTranslation();
  const { status, data, errorMessage, reload } = useGuardedQuery(() => readingClubApi.getMyEventSubscriptions());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data) setSelected(new Set(data.subscribed));
  }, [data]);

  const toggle = (eventType: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(eventType)) next.delete(eventType);
      else next.add(eventType);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await readingClubApi.setMyEventSubscriptions([...selected]);
      setSnackbar(t('reading_club.notifications.saved'));
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHero title={t('reading_club.notifications.title')} subtitle={t('reading_club.notifications.subtitle')} />
      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <Card>
          <CardContent>
            {error ? (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            ) : null}
            <FormGroup>
              {(data?.available ?? []).map((eventType) => (
                <FormControlLabel
                  key={eventType}
                  control={<Checkbox checked={selected.has(eventType)} onChange={() => toggle(eventType)} />}
                  label={t(`reading_club.notifications.event.${eventType}`)}
                />
              ))}
            </FormGroup>
            <Button variant="contained" onClick={save} disabled={saving} sx={{ mt: 2 }}>
              {t('reading_club.notifications.save')}
            </Button>
          </CardContent>
        </Card>
      </QueryStateGate>
      <Snackbar open={snackbar !== null} autoHideDuration={4000} onClose={() => setSnackbar(null)} message={snackbar ?? ''} />
    </Box>
  );
}
