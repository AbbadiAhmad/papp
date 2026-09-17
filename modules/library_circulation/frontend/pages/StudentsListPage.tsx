import AddIcon from '@mui/icons-material/Add';
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
  libraryCirculationApi,
  type CreateStudentInput,
  type CreatedStudent,
  type LibraryStudent,
  type UpdateStudentInput,
} from '../api';
import { StudentFormDialog } from './StudentFormDialog';

export function StudentsListPage() {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const { status, data: students, errorMessage, reload } = useGuardedQuery('library_circulation.students.view', () =>
    libraryCirculationApi.listStudents(),
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<LibraryStudent | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LibraryStudent | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [createdStudent, setCreatedStudent] = useState<CreatedStudent | null>(null);

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
      await gated('library_circulation.students.update', () => libraryCirculationApi.updateStudent(editingStudent.id, dto));
      reload();
    } else {
      const created = await gated('library_circulation.students.create', () =>
        libraryCirculationApi.createStudent(dto as CreateStudentInput),
      );
      reload();
      setCreatedStudent(created); // reveal the one-time temporary password
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

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h4" component="h2">
          {t('library_circulation.menu.students')}
        </Typography>
        <Can permission="library_circulation.students.create">
          <Button startIcon={<AddIcon />} variant="contained" onClick={openCreate}>
            {t('library_circulation.students.create_button')}
          </Button>
        </Can>
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('library_circulation.students.code')}</TableCell>
                <TableCell>{t('library_circulation.students.class_name')}</TableCell>
                <TableCell align="right">{t('core.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(students ?? []).map((student) => (
                <TableRow key={student.id} hover>
                  <TableCell>
                    <RouterLink to={`/library-circulation/students/${student.id}`}>{student.code}</RouterLink>
                  </TableCell>
                  <TableCell>{student.className ?? '—'}</TableCell>
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

      <Dialog open={createdStudent !== null} onClose={() => setCreatedStudent(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('library_circulation.students.created_title')}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('library_circulation.students.temporary_password_warning')}
          </Alert>
          <Typography variant="body1">
            {t('core.auth.email')}: <strong>{createdStudent?.email}</strong>
          </Typography>
          <Typography variant="body1">
            {t('library_circulation.students.temporary_password')}: <strong>{createdStudent?.temporaryPassword}</strong>
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreatedStudent(null)} variant="contained">
            {t('core.common.close')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snackbar !== null} autoHideDuration={4000} onClose={() => setSnackbar(null)} message={snackbar} />
    </Box>
  );
}
