import AddIcon from '@mui/icons-material/Add';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { ConfirmDialog } from '../../../../apps/web/src/shared/components/ConfirmDialog';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { Can } from '../../../../apps/web/src/shared/permissions';
import { readingClubApi } from '../api';

/** Episodes (seasons/years) — the top-level scope groups/stages/readers now live under. Lists every episode, highlights the current one, and lets a permitted user start a new one (which closes whatever was current). */
export function EpisodesPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { status, data: episodes, errorMessage, reload } = useGuardedQuery(() => readingClubApi.listEpisodes());

  const [createOpen, setCreateOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const current = (episodes ?? []).find((e) => e.isCurrent) ?? null;

  const openCreate = () => {
    setName('');
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      await readingClubApi.createEpisode({ name: name.trim() });
      setCreateOpen(false);
      setConfirmOpen(false);
      reload();
    } catch (err) {
      setSnackbar(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h4" component="h2">
          {t('reading_club.menu.episodes')}
        </Typography>
        <Can permission="reading_club.episodes.manage">
          <Button startIcon={<AddIcon />} variant="contained" onClick={openCreate}>
            {t('reading_club.episodes.start_new_button')}
          </Button>
        </Can>
      </Stack>

      {current ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('reading_club.episodes.current_is', { name: current.name })}
        </Alert>
      ) : null}

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('reading_club.fields.name')}</TableCell>
                <TableCell>{t('core.common.status')}</TableCell>
                <TableCell>{t('reading_club.episodes.starts_at')}</TableCell>
                <TableCell>{t('reading_club.episodes.ends_at')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(episodes ?? []).map((episode) => (
                <TableRow key={episode.id} hover>
                  <TableCell>{episode.name}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={episode.isCurrent ? t('reading_club.episodes.current') : t('reading_club.episodes.closed')}
                      color={episode.isCurrent ? 'success' : 'default'}
                    />
                  </TableCell>
                  <TableCell>{formatDateOnly(episode.startsAt, language)}</TableCell>
                  <TableCell>{episode.endsAt ? formatDateOnly(episode.endsAt, language) : '—'}</TableCell>
                </TableRow>
              ))}
              {(episodes ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography variant="body2" color="text.secondary">
                      {t('core.common.no_data')}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>
      </QueryStateGate>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('reading_club.episodes.start_new_title')}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label={t('reading_club.fields.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={saving}>
            {t('core.common.cancel')}
          </Button>
          <Button
            variant="contained"
            disabled={!name.trim() || saving}
            onClick={() => (current ? setConfirmOpen(true) : handleCreate())}
          >
            {t('reading_club.episodes.start_new_button')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title={t('reading_club.episodes.start_new_title')}
        description={t('reading_club.episodes.start_new_confirm', { current: current?.name ?? '' })}
        confirmLabel={t('reading_club.episodes.start_new_button')}
        confirmColor="primary"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleCreate}
      />

      <Snackbar open={snackbar !== null} autoHideDuration={4000} onClose={() => setSnackbar(null)} message={snackbar} />
    </Box>
  );
}
