import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import GroupIcon from '@mui/icons-material/Group';
import {
  Alert,
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
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryStateGate } from '../../shared/components/QueryStateGate';
import { ConfirmDialog } from '../../shared/components/ConfirmDialog';
import { useGuardedQuery } from '../../shared/hooks/useGuardedQuery';
import { extractErrorMessage } from '../../shared/api/httpClient';
import { rolesApi, type CreateRoleInput, type UpdateRoleInput } from '../../shared/api/roles';
import { useGatedCall, Can } from '../../shared/permissions';
import type { PublicRole } from '../../shared/api/types';
import { RoleFormDialog } from './RoleFormDialog';
import { RoleAssignDialog } from './RoleAssignDialog';

export function RolesListPage() {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const { status, data: roles, errorMessage, reload } = useGuardedQuery('roles.view', () => rolesApi.list());

  const [formOpen, setFormOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<PublicRole | null>(null);
  const [assignRole, setAssignRole] = useState<PublicRole | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PublicRole | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const handleSubmit = async (dto: CreateRoleInput | UpdateRoleInput) => {
    if (editingRole) {
      await gated('roles.update', () => rolesApi.update(editingRole.id, dto as UpdateRoleInput));
    } else {
      await gated('roles.create', () => rolesApi.create(dto as CreateRoleInput));
    }
    reload();
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await gated('roles.delete', () => rolesApi.remove(pendingDelete.id));
      reload();
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" component="h2">
          {t('core.menu.roles')}
        </Typography>
        <Can permission="roles.create">
          <Button
            startIcon={<AddIcon />}
            variant="contained"
            onClick={() => {
              setEditingRole(null);
              setFormOpen(true);
            }}
          >
            {t('core.common.create')}
          </Button>
        </Can>
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('core.roles.code')}</TableCell>
                <TableCell>{t('core.roles.name_i18n_key')}</TableCell>
                <TableCell>{t('core.roles.system')}</TableCell>
                <TableCell align="right">{t('core.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(roles ?? []).map((role) => (
                <TableRow key={role.id} hover>
                  <TableCell>{role.code}</TableCell>
                  <TableCell>{t(role.nameI18nKey)}</TableCell>
                  <TableCell>{role.isSystem ? <Chip size="small" label={t('core.roles.system')} /> : null}</TableCell>
                  <TableCell align="right">
                    <Can permission="roles.assign">
                      <IconButton size="small" onClick={() => setAssignRole(role)} aria-label={t('core.roles.assign_users')}>
                        <GroupIcon fontSize="small" />
                      </IconButton>
                    </Can>
                    <Can permission="roles.update">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setEditingRole(role);
                          setFormOpen(true);
                        }}
                        aria-label={t('core.common.edit')}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Can>
                    {!role.isSystem ? (
                      <Can permission="roles.delete">
                        <IconButton size="small" onClick={() => setPendingDelete(role)} aria-label={t('core.common.delete')}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Can>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </QueryStateGate>

      <RoleFormDialog open={formOpen} role={editingRole} onClose={() => setFormOpen(false)} onSubmit={handleSubmit} />
      <RoleAssignDialog open={assignRole !== null} role={assignRole} onClose={() => setAssignRole(null)} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('core.roles.delete_title')}
        description={t('core.roles.delete_confirm', { code: pendingDelete?.code ?? '' })}
        confirmColor="error"
        confirmLabel={t('core.common.delete')}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <Snackbar open={snackbar !== null} autoHideDuration={5000} onClose={() => setSnackbar(null)}>
        <Alert severity="error" onClose={() => setSnackbar(null)}>
          {snackbar}
        </Alert>
      </Snackbar>
    </Box>
  );
}
