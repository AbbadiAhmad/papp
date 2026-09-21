import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ListAltIcon from '@mui/icons-material/ListAlt';
import {
  Box,
  Button,
  Chip,
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
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../../../apps/web/src/shared/components/ConfirmDialog';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { readingClubApi, type CreateGroupInput, type ReadingClubGroup, type UpdateGroupInput } from '../api';
import { GroupFormDialog } from './GroupFormDialog';
import { StagesManagerDialog } from './StagesManagerDialog';

/** "The librarian can create multiple groups, each group contains multiple stages" — this page is the configuration surface for both (docs/DOCUMENTATION.md explains why this is plain entity CRUD, not the manifest's `settings[]` blob). */
export function GroupsListPage() {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const { status, data: groups, errorMessage, reload } = useGuardedQuery(() => readingClubApi.listGroups());

  const [formOpen, setFormOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ReadingClubGroup | null>(null);
  const [stagesGroup, setStagesGroup] = useState<ReadingClubGroup | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ReadingClubGroup | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const openCreate = () => {
    setEditingGroup(null);
    setFormOpen(true);
  };
  const openEdit = (group: ReadingClubGroup) => {
    setEditingGroup(group);
    setFormOpen(true);
  };

  const handleSubmit = async (dto: CreateGroupInput | UpdateGroupInput) => {
    if (editingGroup) {
      await gated('reading_club.groups.update', () => readingClubApi.updateGroup(editingGroup.id, dto));
    } else {
      await gated('reading_club.groups.create', () => readingClubApi.createGroup(dto as CreateGroupInput));
    }
    reload();
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await gated('reading_club.groups.delete', () => readingClubApi.removeGroup(pendingDelete.id));
      reload();
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h4" component="h2">
          {t('reading_club.menu.groups')}
        </Typography>
        <Can permission="reading_club.groups.create">
          <Button startIcon={<AddIcon />} variant="contained" onClick={openCreate}>
            {t('reading_club.groups.create_button')}
          </Button>
        </Can>
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('reading_club.fields.name')}</TableCell>
                <TableCell>{t('reading_club.fields.description')}</TableCell>
                <TableCell>{t('reading_club.groups.stage_count')}</TableCell>
                <TableCell>{t('core.common.status')}</TableCell>
                <TableCell align="right">{t('core.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(groups ?? []).map((group) => (
                <TableRow key={group.id} hover>
                  <TableCell>{group.name}</TableCell>
                  <TableCell>{group.description ?? '—'}</TableCell>
                  <TableCell>{group.stages.length}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={group.isActive ? t('reading_club.groups.active') : t('reading_club.groups.inactive')}
                      color={group.isActive ? 'success' : 'default'}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={t('reading_club.stages.manage_title')}>
                      <IconButton size="small" onClick={() => setStagesGroup(group)} aria-label={t('reading_club.stages.manage_title')}>
                        <ListAltIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Can permission="reading_club.groups.update">
                      <Tooltip title={t('core.common.edit')}>
                        <IconButton size="small" onClick={() => openEdit(group)} aria-label={t('core.common.edit')}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Can>
                    <Can permission="reading_club.groups.delete">
                      <Tooltip title={t('core.common.delete')}>
                        <IconButton size="small" onClick={() => setPendingDelete(group)} aria-label={t('core.common.delete')}>
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
      </QueryStateGate>

      <GroupFormDialog open={formOpen} group={editingGroup} onClose={() => setFormOpen(false)} onSubmit={handleSubmit} />

      <StagesManagerDialog open={stagesGroup !== null} group={stagesGroup} onClose={() => setStagesGroup(null)} onChanged={reload} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('reading_club.groups.delete_title')}
        description={t('reading_club.groups.delete_confirm', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('core.common.delete')}
        confirmColor="error"
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />

      <Snackbar open={snackbar !== null} autoHideDuration={4000} onClose={() => setSnackbar(null)} message={snackbar} />
    </Box>
  );
}
