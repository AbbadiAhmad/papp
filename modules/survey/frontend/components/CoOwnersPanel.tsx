import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { Alert, Box, Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { surveyApi, type CoOwner } from '../api';

/**
 * Co-owners of one survey (SURVEY-D21): people who may edit, publish and read the results of THIS survey. Shown
 * to the survey's creator and to anyone holding survey.surveys.share; a co-owner sees the list read-only.
 */
export function CoOwnersPanel({ surveyId, canManage }: { surveyId: string; canManage: boolean }) {
  const { t } = useTranslation();
  const [owner, setOwner] = useState<CoOwner | null>(null);
  const [coOwners, setCoOwners] = useState<CoOwner[]>([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (data: { owner: CoOwner; coOwners: CoOwner[] }) => {
    setOwner(data.owner);
    setCoOwners(data.coOwners);
  };

  const load = useCallback(() => {
    surveyApi
      .listCoOwners(surveyId)
      .then(apply)
      .catch((err: unknown) => setError(extractErrorMessage(err)));
  }, [surveyId]);

  useEffect(load, [load]);

  const add = async () => {
    const value = email.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      apply(await surveyApi.addCoOwner(surveyId, value));
      setEmail('');
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId: string) => {
    setError(null);
    try {
      apply(await surveyApi.removeCoOwner(surveyId, userId));
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle1" component="h3" gutterBottom>
        {t('survey.coowners.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t('survey.coowners.hint')}
      </Typography>
      {error ? (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 1.5, gap: 1 }}>
        {owner ? <Chip color="primary" label={`${owner.name} (${t('survey.coowners.owner')})`} /> : null}
        {coOwners.map((c) => (
          <Chip key={c.userId} label={`${c.name} · ${c.email}`} onDelete={canManage ? () => void remove(c.userId) : undefined} />
        ))}
        {coOwners.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('survey.coowners.none')}
          </Typography>
        ) : null}
      </Stack>
      {canManage ? (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <TextField
            size="small"
            type="email"
            label={t('survey.coowners.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void add();
              }
            }}
            sx={{ minWidth: 260 }}
          />
          <Button startIcon={<PersonAddIcon />} variant="outlined" disabled={busy || !email.trim()} onClick={() => void add()}>
            {t('survey.coowners.add')}
          </Button>
        </Box>
      ) : null}
    </Paper>
  );
}
