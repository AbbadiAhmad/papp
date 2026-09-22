import AddIcon from '@mui/icons-material/Add';
import BlockIcon from '@mui/icons-material/Block';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
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
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { Can } from '../../../../apps/web/src/shared/permissions';
import { readingClubApi, type ReadingClubStageBookEntry } from '../api';

/**
 * "Books read this stage" (item D) — lists auto-synced (from returned
 * borrowings) and manually-added book entries for a reader's CURRENT stage,
 * distinguishable by a small source chip. Every entry supports both a soft
 * "discard" (stays visible, struck-through, excluded from any count) and a
 * hard "delete" (gone entirely) — gated by
 * `reading_club.memberships.update_progress`, the closest existing
 * permission for editing a reader's stage-tracking data (see DECISIONS.md
 * READING_CLUB-D14).
 */
export function StageBookEntriesCard({ studentId }: { studentId: string }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { data: entries, reload } = useGuardedQuery(() => readingClubApi.listBookEntries(studentId));

  const [addOpen, setAddOpen] = useState(false);
  const [bookTitle, setBookTitle] = useState('');
  const [bookCode, setBookCode] = useState('');
  const [comments, setComments] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const [discardTarget, setDiscardTarget] = useState<ReadingClubStageBookEntry | null>(null);
  const [discardReason, setDiscardReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ReadingClubStageBookEntry | null>(null);

  const openAdd = () => {
    setBookTitle('');
    setBookCode('');
    setComments('');
    setError(null);
    setAddOpen(true);
  };

  const handleAdd = async () => {
    if (!bookTitle.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await readingClubApi.addBookEntry(studentId, {
        bookTitle: bookTitle.trim(),
        bookCode: bookCode.trim() || undefined,
        comments: comments.trim() || undefined,
      });
      setAddOpen(false);
      reload();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = async () => {
    if (!discardTarget) return;
    try {
      await readingClubApi.discardBookEntry(studentId, discardTarget.id, discardReason.trim() || undefined);
      reload();
    } catch (err) {
      setSnackbar(extractErrorMessage(err));
    } finally {
      setDiscardTarget(null);
      setDiscardReason('');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await readingClubApi.removeBookEntry(studentId, deleteTarget.id);
      reload();
    } catch (err) {
      setSnackbar(extractErrorMessage(err));
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <Card>
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 2 }}>
          <Typography variant="h6">{t('reading_club.book_entries.heading')}</Typography>
          <Can permission="reading_club.memberships.update_progress">
            <Button size="small" startIcon={<AddIcon />} onClick={openAdd}>
              {t('reading_club.book_entries.add_button')}
            </Button>
          </Can>
        </Stack>

        {(entries ?? []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('reading_club.book_entries.empty')}
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('reading_club.book_entries.book_title')}</TableCell>
                  <TableCell>{t('reading_club.book_entries.book_code')}</TableCell>
                  <TableCell>{t('reading_club.book_entries.added_at')}</TableCell>
                  <TableCell align="right">{t('core.common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(entries ?? []).map((entry) => (
                  <TableRow key={entry.id} sx={entry.status === 'discarded' ? { opacity: 0.55 } : undefined}>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <span style={entry.status === 'discarded' ? { textDecoration: 'line-through' } : undefined}>
                          {entry.bookTitle}
                        </span>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={t(`reading_club.book_entries.source.${entry.source}`)}
                        />
                        {entry.status === 'discarded' ? (
                          <Chip size="small" color="default" label={t('reading_club.book_entries.discarded_label')} />
                        ) : null}
                      </Stack>
                    </TableCell>
                    <TableCell>{entry.bookCode ?? '—'}</TableCell>
                    <TableCell>{formatDateOnly(entry.addedAt, language)}</TableCell>
                    <TableCell align="right">
                      <Can permission="reading_club.memberships.update_progress">
                        {entry.status === 'active' ? (
                          <Tooltip title={t('reading_club.book_entries.discard_button')}>
                            <IconButton size="small" onClick={() => setDiscardTarget(entry)} aria-label={t('reading_club.book_entries.discard_button')}>
                              <BlockIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        ) : null}
                        <Tooltip title={t('reading_club.book_entries.delete_button')}>
                          <IconButton size="small" onClick={() => setDeleteTarget(entry)} aria-label={t('reading_club.book_entries.delete_button')}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Can>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('reading_club.book_entries.add_title')}</DialogTitle>
        <DialogContent>
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          ) : null}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              fullWidth
              label={t('reading_club.book_entries.book_title')}
              value={bookTitle}
              onChange={(e) => setBookTitle(e.target.value)}
              disabled={saving}
            />
            <TextField
              fullWidth
              label={t('reading_club.book_entries.book_code')}
              value={bookCode}
              onChange={(e) => setBookCode(e.target.value)}
              disabled={saving}
            />
            <TextField
              fullWidth
              multiline
              minRows={2}
              label={t('reading_club.book_entries.comments')}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              disabled={saving}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)} disabled={saving}>
            {t('core.common.cancel')}
          </Button>
          <Button variant="contained" onClick={handleAdd} disabled={saving || !bookTitle.trim()}>
            {t('reading_club.book_entries.add_button')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={discardTarget !== null} onClose={() => setDiscardTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('reading_club.book_entries.discard_title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t('reading_club.book_entries.discard_confirm', { title: discardTarget?.bookTitle ?? '' })}
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={2}
            label={t('reading_club.book_entries.discard_reason')}
            value={discardReason}
            onChange={(e) => setDiscardReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDiscardTarget(null)}>{t('core.common.cancel')}</Button>
          <Button variant="contained" onClick={handleDiscard}>
            {t('reading_club.book_entries.discard_button')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('reading_club.book_entries.delete_title')}
        description={t('reading_club.book_entries.delete_confirm', { title: deleteTarget?.bookTitle ?? '' })}
        confirmLabel={t('core.common.delete')}
        confirmColor="error"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />

      <Snackbar open={snackbar !== null} autoHideDuration={4000} onClose={() => setSnackbar(null)} message={snackbar} />
    </Card>
  );
}
