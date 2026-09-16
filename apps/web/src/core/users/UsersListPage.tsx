import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import UploadFileIcon from '@mui/icons-material/UploadFile';
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
import { Link as RouterLink } from 'react-router-dom';
import { useLanguage } from '../../app/LanguageContext';
import { QueryStateGate } from '../../shared/components/QueryStateGate';
import { ConfirmDialog } from '../../shared/components/ConfirmDialog';
import { formatDateTime } from '../../shared/format';
import { useGuardedQuery } from '../../shared/hooks/useGuardedQuery';
import { extractErrorMessage } from '../../shared/api/httpClient';
import { downloadBlob, usersApi, type CreateUserInput, type UpdateUserInput } from '../../shared/api/users';
import { useGatedCall, Can } from '../../shared/permissions';
import type { PublicUser } from '../../shared/api/types';
import { UserFormDialog } from './UserFormDialog';

export function UsersListPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const gated = useGatedCall();
  const { status, data: users, errorMessage, reload } = useGuardedQuery('users.view', () => usersApi.list());

  const [formOpen, setFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<PublicUser | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PublicUser | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const openCreate = () => {
    setEditingUser(null);
    setFormOpen(true);
  };
  const openEdit = (user: PublicUser) => {
    setEditingUser(user);
    setFormOpen(true);
  };

  const handleSubmit = async (dto: CreateUserInput | UpdateUserInput) => {
    if (editingUser) {
      await gated('users.update', () => usersApi.update(editingUser.id, dto as UpdateUserInput));
    } else {
      await gated('users.create', () => usersApi.create(dto as CreateUserInput));
    }
    reload();
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await gated('users.delete', () => usersApi.remove(pendingDelete.id));
      reload();
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    } finally {
      setPendingDelete(null);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await gated('users.export', () => usersApi.exportUsers());
      downloadBlob(blob, 'users-export.xlsx');
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" component="h2">
          {t('core.menu.users')}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Can permission="users.export">
            <Button startIcon={<DownloadIcon />} onClick={handleExport} variant="outlined">
              {t('core.users.export')}
            </Button>
          </Can>
          <Can permission="users.import">
            <Button startIcon={<UploadFileIcon />} component={RouterLink} to="/users/import" variant="outlined">
              {t('core.users.import')}
            </Button>
          </Can>
          <Can permission="users.create">
            <Button startIcon={<AddIcon />} onClick={openCreate} variant="contained">
              {t('core.common.create')}
            </Button>
          </Can>
        </Stack>
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('core.auth.name')}</TableCell>
                <TableCell>{t('core.auth.email')}</TableCell>
                <TableCell>{t('core.users.department')}</TableCell>
                <TableCell>{t('core.users.status')}</TableCell>
                <TableCell>{t('core.users.last_login')}</TableCell>
                <TableCell align="right">{t('core.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(users ?? []).map((user) => (
                <TableRow key={user.id} hover>
                  <TableCell>{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.department ?? '—'}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      <Chip
                        size="small"
                        label={user.isActive ? t('core.users.active') : t('core.users.inactive')}
                        color={user.isActive ? 'success' : 'default'}
                      />
                      {user.mustChangePassword ? (
                        <Chip size="small" label={t('core.users.must_change_password')} color="warning" />
                      ) : null}
                    </Stack>
                  </TableCell>
                  <TableCell>{user.lastLoginAt ? formatDateTime(user.lastLoginAt, language) : '—'}</TableCell>
                  <TableCell align="right">
                    <Can permission="users.update">
                      <IconButton size="small" onClick={() => openEdit(user)} aria-label={t('core.common.edit')}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Can>
                    <Can permission="users.delete">
                      <IconButton size="small" onClick={() => setPendingDelete(user)} aria-label={t('core.common.delete')}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </QueryStateGate>

      <UserFormDialog open={formOpen} user={editingUser} onClose={() => setFormOpen(false)} onSubmit={handleSubmit} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('core.users.delete_title')}
        description={t('core.users.delete_confirm', { name: pendingDelete?.name ?? '' })}
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
