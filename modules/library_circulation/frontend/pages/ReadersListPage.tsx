import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/Download';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
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
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { ConfirmDialog } from '../../../../apps/web/src/shared/components/ConfirmDialog';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { extractErrorMessage, isForbiddenError } from '../../../../apps/web/src/shared/api/httpClient';
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import {
  downloadBlob,
  libraryCirculationApi,
  type CreateStudentInput,
  type LibraryStudent,
  type StudentListPage,
  type StudentListQuery,
  type UpdateStudentInput,
} from '../api';
import { QrCodeImage } from './QrCodeImage';
import { PageHero } from '../../../../apps/web/src/shared/ui/kit';
import { ReaderFormDialog } from './ReaderFormDialog';
import { ReadersImportDialog } from './ReadersImportDialog';

export function ReadersListPage() {
  const { t } = useTranslation();
  const gated = useGatedCall();

  // Filters are applied on the server; `applied` is what the last request used, `draft*` is what's typed.
  const [searchText, setSearchText] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<NonNullable<StudentListQuery['status']>>('all');
  const [borrowingFilter, setBorrowingFilter] = useState<NonNullable<StudentListQuery['borrowing']>>('all');
  const [sortBy, setSortBy] = useState<NonNullable<StudentListQuery['sortBy']>>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1); // 1-based, like the API
  const [pageSize, setPageSize] = useState(25);
  const [debounced, setDebounced] = useState({ q: '', className: '' });
  const [reloadToken, setReloadToken] = useState(0);
  const [result, setResult] = useState<StudentListPage | undefined>(undefined);
  const [status, setStatus] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const reload = () => setReloadToken((n) => n + 1);

  // Typing is debounced so each keystroke doesn't hit the server.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced({ q: searchText, className: classFilter }), 300);
    return () => clearTimeout(timer);
  }, [searchText, classFilter]);

  useEffect(() => {
    let cancelled = false;
    libraryCirculationApi
      .listStudentsPaged({ q: debounced.q, className: debounced.className, status: statusFilter, borrowing: borrowingFilter, sortBy, sortDir, page, pageSize })
      .then((data) => {
        if (cancelled) return;
        // Deleting/filtering can leave the current page past the end — jump to the last real page.
        const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
        if (page > lastPage) {
          setPage(lastPage);
          return;
        }
        setResult(data);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus(isForbiddenError(error) ? 'forbidden' : 'error');
        setErrorMessage(extractErrorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, statusFilter, borrowingFilter, sortBy, sortDir, page, pageSize, reloadToken]);

  const students = result?.items;
  const hasFilters = Boolean(searchText || classFilter || statusFilter !== 'all' || borrowingFilter !== 'all');
  const clearFilters = () => {
    setSearchText('');
    setClassFilter('');
    setStatusFilter('all');
    setBorrowingFilter('all');
    setDebounced({ q: '', className: '' });
    setPage(1);
  };
  /** Any filter change goes back to page 1 — staying on page 7 of a result that now has 2 pages shows an empty table. */
  const changeFilter = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };
  const toggleSort = (column: NonNullable<StudentListQuery['sortBy']>) => {
    if (sortBy === column) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortDir(column === 'createdAt' ? 'desc' : 'asc');
    }
    setPage(1);
  };

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
      <Box sx={{ mb: 2 }}>
        <PageHero title={t('library_circulation.menu.students')} subtitle={t('library_circulation.students.subtitle')} />
      </Box>
      <Stack direction="row" sx={{ justifyContent: 'flex-end', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
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

      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 2, alignItems: 'center' }}>
        <TextField
          size="small"
          label={t('library_circulation.students.filter_search')}
          value={searchText}
          onChange={(e) => changeFilter(setSearchText)(e.target.value)}
          sx={{ minWidth: 260 }}
        />
        <TextField
          size="small"
          label={t('library_circulation.students.class_name')}
          value={classFilter}
          onChange={(e) => changeFilter(setClassFilter)(e.target.value)}
          sx={{ width: 150 }}
        />
        <TextField
          select
          size="small"
          label={t('library_circulation.students.status')}
          value={statusFilter}
          onChange={(e) => changeFilter(setStatusFilter)(e.target.value as typeof statusFilter)}
          sx={{ width: 160 }}
        >
          <MenuItem value="all">{t('library_circulation.students.filter_any')}</MenuItem>
          <MenuItem value="active">{t('library_circulation.students.status_active')}</MenuItem>
          <MenuItem value="inactive">{t('library_circulation.students.status_inactive')}</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label={t('library_circulation.students.active_borrowings')}
          value={borrowingFilter}
          onChange={(e) => changeFilter(setBorrowingFilter)(e.target.value as typeof borrowingFilter)}
          sx={{ width: 220 }}
        >
          <MenuItem value="all">{t('library_circulation.students.filter_any')}</MenuItem>
          <MenuItem value="out">{t('library_circulation.students.filter_has_books')}</MenuItem>
          <MenuItem value="overdue">{t('library_circulation.students.filter_overdue')}</MenuItem>
          <MenuItem value="none">{t('library_circulation.students.filter_no_books')}</MenuItem>
        </TextField>
        {hasFilters ? <Button onClick={clearFilters}>{t('library_circulation.students.clear_filters')}</Button> : null}
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sortDirection={sortBy === 'code' ? sortDir : false}>
                  <TableSortLabel active={sortBy === 'code'} direction={sortBy === 'code' ? sortDir : 'asc'} onClick={() => toggleSort('code')}>
                    {t('library_circulation.students.code')}
                  </TableSortLabel>
                </TableCell>
                <TableCell>{t('library_circulation.students.name')}</TableCell>
                <TableCell>{t('core.auth.email')}</TableCell>
                <TableCell sortDirection={sortBy === 'className' ? sortDir : false}>
                  <TableSortLabel active={sortBy === 'className'} direction={sortBy === 'className' ? sortDir : 'asc'} onClick={() => toggleSort('className')}>
                    {t('library_circulation.students.class_name')}
                  </TableSortLabel>
                </TableCell>
                <TableCell align="center">{t('library_circulation.students.active_borrowings')}</TableCell>
                <TableCell>{t('library_circulation.students.status')}</TableCell>
                <TableCell align="right">{t('core.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(students ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    {t('library_circulation.students.no_results')}
                  </TableCell>
                </TableRow>
              ) : null}
              {(students ?? []).map((student) => (
                <TableRow key={student.id} hover>
                  <TableCell>
                    <RouterLink to={`/library-circulation/readers/${student.id}`}>{student.code}</RouterLink>
                  </TableCell>
                  <TableCell>
                    {student.name ? <RouterLink to={`/library-circulation/readers/${student.id}`}>{student.name}</RouterLink> : '—'}
                    {student.isReader === false ? (
                      <Chip size="small" color="warning" label={t('library_circulation.students.not_reader_anymore')} sx={{ marginInlineStart: 1 }} />
                    ) : null}
                  </TableCell>
                  <TableCell>{student.email ?? '—'}</TableCell>
                  <TableCell>{student.className ?? '—'}</TableCell>
                  <TableCell align="center">{student.activeBorrowingsCount ?? 0}</TableCell>
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
          <TablePagination
            component="div"
            count={result?.total ?? 0}
            page={page - 1}
            onPageChange={(_event, newPage) => setPage(newPage + 1)}
            rowsPerPage={pageSize}
            rowsPerPageOptions={[10, 25, 50, 100]}
            onRowsPerPageChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            labelRowsPerPage={t('library_circulation.students.rows_per_page')}
            labelDisplayedRows={({ from, to, count }) => t('library_circulation.students.displayed_rows', { from, to, count })}
          />
        </TableContainer>
      </QueryStateGate>

      <ReaderFormDialog open={formOpen} student={editingStudent} onClose={() => setFormOpen(false)} onSubmit={handleSubmit} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('library_circulation.students.delete_title')}
        description={t('library_circulation.students.delete_confirm', { code: pendingDelete?.code ?? '' })}
        confirmLabel={t('core.common.delete')}
        confirmColor="error"
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />

      <ReadersImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={reload} />

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
