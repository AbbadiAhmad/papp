import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
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
  Tooltip,
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
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { readingClubApi, type ReadingClubEpisode } from '../api';
import { TypeToConfirmDialog } from './TypeToConfirmDialog';

/** Episodes (seasons/years) — the top-level scope groups/stages/readers now live under. Lists every episode, highlights the current one, and lets a permitted user start a new one (which closes whatever was current). */
interface DeletePreview {
  groupCount: number;
  readerCount: number;
  completionCount: number;
  bookEntryCount: number;
}

export function EpisodesPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const gated = useGatedCall();
  const { status, data: episodes, errorMessage, reload } = useGuardedQuery(() => readingClubApi.listEpisodes());

  const [createOpen, setCreateOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<ReadingClubEpisode | null>(null);
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null);
  const [deletePreviewLoading, setDeletePreviewLoading] = useState(false);

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

  const openDelete = async (episode: ReadingClubEpisode) => {
    setPendingDelete(episode);
    setDeletePreview(null);
    setDeletePreviewLoading(true);
    try {
      const preview = await readingClubApi.getEpisodeDeletePreview(episode.id);
      setDeletePreview(preview);
    } catch (err) {
      setSnackbar(extractErrorMessage(err));
    } finally {
      setDeletePreviewLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const deleted = pendingDelete;
    try {
      const result = await gated('reading_club.episodes.manage', () => readingClubApi.removeEpisode(deleted.id));
      reload();
      setSnackbar(
        result.wasCurrent
          ? t('reading_club.episodes.delete_success_was_current', { name: deleted.name })
          : t('reading_club.episodes.delete_success', { name: deleted.name }),
      );
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    } finally {
      setPendingDelete(null);
      setDeletePreview(null);
    }
  };

  const deleteWarningLines: string[] = [];
  if (pendingDelete?.isCurrent) {
    deleteWarningLines.push(t('reading_club.episodes.delete_current_warning', { name: pendingDelete.name }));
  }
  if (deletePreview) {
    const hasAnything =
      deletePreview.groupCount > 0 || deletePreview.readerCount > 0 || deletePreview.completionCount > 0 || deletePreview.bookEntryCount > 0;
    deleteWarningLines.push(
      hasAnything
        ? t('reading_club.episodes.delete_counts_warning', {
            groupCount: deletePreview.groupCount,
            readerCount: deletePreview.readerCount,
            completionCount: deletePreview.completionCount,
            bookEntryCount: deletePreview.bookEntryCount,
          })
        : t('reading_club.episodes.delete_empty_note'),
    );
  } else if (deletePreviewLoading) {
    deleteWarningLines.push(t('core.common.loading'));
  }

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
                <TableCell align="right">{t('core.common.actions')}</TableCell>
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
                  <TableCell align="right">
                    <Can permission="reading_club.episodes.manage">
                      <Tooltip title={t('core.common.delete')}>
                        <IconButton size="small" onClick={() => openDelete(episode)} aria-label={t('core.common.delete')}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
              {(episodes ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
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

      <TypeToConfirmDialog
        open={pendingDelete !== null}
        title={t('reading_club.episodes.delete_title')}
        description={t('reading_club.episodes.delete_confirm', { name: pendingDelete?.name ?? '' })}
        warning={deleteWarningLines.length > 0 ? deleteWarningLines.join(' ') : null}
        expectedText={pendingDelete?.name ?? ''}
        confirmLabel={t('core.common.delete')}
        onCancel={() => {
          setPendingDelete(null);
          setDeletePreview(null);
        }}
        onConfirm={handleDelete}
      />

      <Snackbar open={snackbar !== null} autoHideDuration={4000} onClose={() => setSnackbar(null)} message={snackbar} />
    </Box>
  );
}
