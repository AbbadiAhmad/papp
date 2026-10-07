import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/Download';
import UploadFileIcon from '@mui/icons-material/UploadFile';
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
import { Link as RouterLink } from 'react-router-dom';
import { ConfirmDialog } from '../../../../apps/web/src/shared/components/ConfirmDialog';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import {
  downloadBlob,
  libraryCirculationApi,
  type CreateStudentInput,
  type LibraryStudent,
  type UpdateStudentInput,
} from '../api';
import { QrCodeImage } from './QrCodeImage';
import { StudentFormDialog } from './StudentFormDialog';
import { StudentsImportDialog } from './StudentsImportDialog';

export function StudentsListPage() {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const { status, data: students, errorMessage, reload } = useGuardedQuery(() =>
    libraryCirculationApi.listStudents(),
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<LibraryStudent | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LibraryStudent | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  // One-time credentials reveal — after creating a reader, or after an admin "reset password" on edit.
  const [credentials, setCredentials] = useState<{ email: string; code: string; temporaryPassword: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const openCreate = () => {
    setEditingStudent(null);
    setFormOpen(true);
  };
  const openEdit = (student: LibraryStudent) => {
    setEditingStudent(student);
    setFormOpen(true);
  };

  const handleSubmit = async (dto: CreateStudentInput | UpdateStudentInput) => {
    if (editingStudent) {
      const updated = await gated('library_circulation.students.update', () => libraryCirculationApi.updateStudent(editingStudent.id, dto));
      reload();
      if (updated.temporaryPassword) {
        setCredentials({ email: updated.email ?? '', code: updated.code, temporaryPassword: updated.temporaryPassword });
      }
    } else {
      const created = await gated('library_circulation.students.create', () =>
        libraryCirculationApi.createStudent(dto as CreateStudentInput),
      );
      reload();
      setCredentials({ email: created.email, code: created.code, temporaryPassword: created.temporaryPassword }); // reveal the one-time temporary password
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await gated('library_circulation.students.delete', () => libraryCirculationApi.removeStudent(pendingDelete.id));
      reload();
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    } finally {
      setPendingDelete(null);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await gated('library_circulation.students.export', () => libraryCirculationApi.exportStudents());
      downloadBlob(blob, 'library-readers-export.xlsx');
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h4" component="h2">
          {t('library_circulation.menu.students')}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Can permission="library_circulation.students.export">
            <Button startIcon={<DownloadIcon />} variant="outlined" onClick={handleExport}>
              {t('library_circulation.students.export')}
            </Button>
          </Can>
          <Can permission="library_circulation.students.import">
            <Button startIcon={<UploadFileIcon />} variant="outlined" onClick={() => setImportOpen(true)}>
              {t('library_circulation.students.import')}
            </Button>
          </Can>
          <Can permission="library_circulation.students.create">
            <Button startIcon={<AddIcon />} variant="contained" onClick={openCreate}>
              {t('library_circulation.students.create_button')}
            </Button>
          </Can>
        </Stack>
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('library_circulation.students.code')}</TableCell>
                <TableCell>{t('library_circulation.students.name')}</TableCell>
                <TableCell>{t('core.auth.email')}</TableCell>
                <TableCell>{t('library_circulation.students.class_name')}</TableCell>
                <TableCell>{t('library_circulation.students.status')}</TableCell>
                <TableCell align="right">{t('core.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(students ?? []).map((student) => (
                <TableRow key={student.id} hover>
                  <TableCell>
                    <RouterLink to={`/library-circulation/students/${student.id}`}>{student.code}</RouterLink>
                  </TableCell>
                  <TableCell>{student.name ?? '—'}</TableCell>
                  <TableCell>{student.email ?? '—'}</TableCell>
                  <TableCell>{student.className ?? '—'}</TableCell>
                  <TableCell>
                    {student.isActive ? t('library_circulation.students.status_active') : t('library_circulation.students.status_inactive')}
                  </TableCell>
                  <TableCell align="right">
                    <Can permission="library_circulation.students.update">
                      <Tooltip title={t('core.common.edit')}>
                        <IconButton size="small" onClick={() => openEdit(student)} aria-label={t('core.common.edit')}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Can>
                    <Can permission="library_circulation.students.delete">
                      <Tooltip title={t('core.common.delete')}>
                        <IconButton size="small" onClick={() => setPendingDelete(student)} aria-label={t('core.common.delete')}>
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

      <StudentFormDialog open={formOpen} student={editingStudent} onClose={() => setFormOpen(false)} onSubmit={handleSubmit} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('library_circulation.students.delete_title')}
        description={t('library_circulation.students.delete_confirm', { code: pendingDelete?.code ?? '' })}
        confirmLabel={t('core.common.delete')}
        confirmColor="error"
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />

      <StudentsImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={reload} />

      <Dialog open={credentials !== null} onClose={() => setCredentials(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('library_circulation.students.created_title')}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('library_circulation.students.temporary_password_warning')}
          </Alert>
          <Typography variant="body1">
            {t('core.auth.email')}: <strong>{credentials?.email}</strong>
          </Typography>
          <Typography variant="body1">
            {t('library_circulation.students.temporary_password')}: <strong>{credentials?.temporaryPassword}</strong>
          </Typography>
          {credentials ? (
            <Stack sx={{ alignItems: 'center', mt: 2 }}>
              <QrCodeImage value={credentials.code} />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                {credentials.code}
              </Typography>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCredentials(null)} variant="contained">
            {t('core.common.close')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snackbar !== null} autoHideDuration={4000} onClose={() => setSnackbar(null)} message={snackbar} />
    </Box>
  );
}
