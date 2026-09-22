import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
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
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../../../apps/web/src/shared/components/ConfirmDialog';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { Can } from '../../../../apps/web/src/shared/permissions';
import { readingClubApi, type ReadingClubGroup, type ReadingClubStage, type StageTargetType } from '../api';

const emptyForm = { stageOrder: 1, name: '', targetType: 'books' as StageTargetType, targetAmount: 5, rewardDescription: '' };

/** "The librarian defines the stages, the amount in every stage, the present after every stage, the stage order" — this dialog IS that configuration surface for one group. */
export function StagesManagerDialog({
  open,
  group,
  onClose,
  onChanged,
}: {
  open: boolean;
  group: ReadingClubGroup | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [stages, setStages] = useState<ReadingClubStage[]>([]);
  const [editingStage, setEditingStage] = useState<ReadingClubStage | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ReadingClubStage | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && group) {
      const groupStages = group.stages ?? [];
      setStages([...groupStages].sort((a, b) => a.stageOrder - b.stageOrder));
      setError(null);
      resetForm(groupStages.length);
    }
  }, [open, group]);

  const resetForm = (existingCount: number) => {
    setEditingStage(null);
    setForm({ ...emptyForm, stageOrder: existingCount + 1 });
  };

  const startEdit = (stage: ReadingClubStage) => {
    setEditingStage(stage);
    setForm({
      stageOrder: stage.stageOrder,
      name: stage.name,
      targetType: stage.targetType,
      targetAmount: stage.targetAmount,
      rewardDescription: stage.rewardDescription ?? '',
    });
  };

  const refresh = async () => {
    if (!group) return;
    const updated = await readingClubApi.getGroup(group.id);
    setStages([...(updated.stages ?? [])].sort((a, b) => a.stageOrder - b.stageOrder));
    onChanged();
  };

  const handleSave = async () => {
    if (!group) return;
    setSaving(true);
    setError(null);
    try {
      const dto = {
        stageOrder: form.stageOrder,
        name: form.name,
        targetType: form.targetType,
        targetAmount: form.targetAmount,
        rewardDescription: form.rewardDescription || undefined,
      };
      if (editingStage) {
        await readingClubApi.updateStage(editingStage.id, dto);
      } else {
        await readingClubApi.createStage(group.id, dto);
      }
      await refresh();
      resetForm(stages.length + (editingStage ? 0 : 1));
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await readingClubApi.removeStage(pendingDelete.id);
      await refresh();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {t('reading_club.stages.manage_title')} — {group?.name}
      </DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        <TableContainer sx={{ mb: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('reading_club.fields.stage_order')}</TableCell>
                <TableCell>{t('reading_club.fields.name')}</TableCell>
                <TableCell>{t('reading_club.fields.target')}</TableCell>
                <TableCell>{t('reading_club.fields.reward_description')}</TableCell>
                <TableCell align="right">{t('core.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {stages.map((stage) => (
                <TableRow key={stage.id} hover>
                  <TableCell>{stage.stageOrder}</TableCell>
                  <TableCell>{stage.name}</TableCell>
                  <TableCell>
                    {stage.targetAmount} {t(`reading_club.target_type.${stage.targetType}`)}
                  </TableCell>
                  <TableCell>{stage.rewardDescription ?? '—'}</TableCell>
                  <TableCell align="right">
                    <Can permission="reading_club.groups.update">
                      <IconButton size="small" onClick={() => startEdit(stage)} aria-label={t('core.common.edit')}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Can>
                    <Can permission="reading_club.groups.delete">
                      <IconButton size="small" onClick={() => setPendingDelete(stage)} aria-label={t('core.common.delete')}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
              {stages.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary">
                      {t('reading_club.groups.no_stages')}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>

        <Can permission="reading_club.groups.update">
          <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <Typography variant="subtitle2" gutterBottom>
              {editingStage ? t('reading_club.stages.edit_title') : t('reading_club.stages.add_title')}
            </Typography>
            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
              <TextField
                label={t('reading_club.fields.stage_order')}
                type="number"
                value={form.stageOrder}
                onChange={(e) => setForm({ ...form, stageOrder: Number(e.target.value) })}
                sx={{ width: 140 }}
              />
              <TextField
                label={t('reading_club.fields.name')}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                sx={{ flex: 1, minWidth: 200 }}
              />
              <TextField
                select
                label={t('reading_club.fields.target_type')}
                value={form.targetType}
                onChange={(e) => setForm({ ...form, targetType: e.target.value as StageTargetType })}
                sx={{ width: 160 }}
              >
                <MenuItem value="books">{t('reading_club.target_type.books')}</MenuItem>
                <MenuItem value="pages">{t('reading_club.target_type.pages')}</MenuItem>
              </TextField>
              <TextField
                label={t('reading_club.fields.target_amount')}
                type="number"
                value={form.targetAmount}
                onChange={(e) => setForm({ ...form, targetAmount: Number(e.target.value) })}
                sx={{ width: 160 }}
              />
              <TextField
                label={t('reading_club.fields.reward_description')}
                value={form.rewardDescription}
                onChange={(e) => setForm({ ...form, rewardDescription: e.target.value })}
                sx={{ flex: 1, minWidth: 220 }}
              />
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              <Button variant="contained" onClick={handleSave} disabled={saving || !form.name.trim() || form.targetAmount < 1}>
                {editingStage ? t('core.common.save') : t('reading_club.stages.add_button')}
              </Button>
              {editingStage ? <Button onClick={() => resetForm(stages.length)}>{t('core.common.cancel')}</Button> : null}
            </Stack>
          </Box>
        </Can>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('core.common.close')}</Button>
      </DialogActions>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('reading_club.stages.delete_title')}
        description={t('reading_club.stages.delete_confirm', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('core.common.delete')}
        confirmColor="error"
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />
    </Dialog>
  );
}
