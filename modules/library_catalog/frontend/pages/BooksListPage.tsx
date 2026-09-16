import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import {
  Alert,
  Box,
  Button,
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
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { ConfirmDialog } from '../../../../apps/web/src/shared/components/ConfirmDialog';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { useGatedCall, Can } from '../../../../apps/web/src/shared/permissions';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { downloadBlob, libraryCatalogApi, type CreateBookInput, type LibraryBook, type UpdateBookInput } from '../api';
import { BookFormDialog } from './BookFormDialog';

/**
 * Follows docs/FEATURE_TEMPLATE.md §2's pattern exactly for the parts that
 * still hold up against the REAL, committed frontend (usePermission/<Can>,
 * formatDate, PageLayout via the app shell) but uses the REAL permission
 * model actually built in this repo (`useGuardedQuery` + `useGatedCall`, see
 * apps/web/src/shared/permissions.tsx's own docblock) rather than
 * FEATURE_TEMPLATE.md's illustrative boolean `usePermission` alone — the
 * committed platform has no `GET /permissions/me/effective` endpoint to back
 * a precomputed permission set, so every gated control here learns its real
 * state from an actual backend call's outcome, exactly like every core page
 * (e.g. apps/web/src/core/users/UsersListPage.tsx) already does.
 */
export function BooksListPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const gated = useGatedCall();
  const [search, setSearch] = useState('');
  const { status, data: books, errorMessage, reload } = useGuardedQuery('library_catalog.books.view', () =>
    libraryCatalogApi.listBooks(search ? { search } : undefined),
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editingBook, setEditingBook] = useState<LibraryBook | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LibraryBook | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const openCreate = () => {
    setEditingBook(null);
    setFormOpen(true);
  };
  const openEdit = (book: LibraryBook) => {
    setEditingBook(book);
    setFormOpen(true);
  };

  const handleSubmit = async (dto: CreateBookInput | UpdateBookInput) => {
    if (editingBook) {
      await gated('library_catalog.books.update', () => libraryCatalogApi.updateBook(editingBook.id, dto));
    } else {
      await gated('library_catalog.books.create', () => libraryCatalogApi.createBook(dto as CreateBookInput));
    }
    reload();
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await gated('library_catalog.books.delete', () => libraryCatalogApi.removeBook(pendingDelete.id));
      reload();
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    } finally {
      setPendingDelete(null);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await gated('library_catalog.books.export', () => libraryCatalogApi.exportBooks());
      downloadBlob(blob, 'library-catalog-books-export.xlsx');
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h5">{t('library_catalog.menu.books')}</Typography>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            placeholder={t('core.common.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && reload()}
          />
          <Can permission="library_catalog.books.export">
            <Button startIcon={<DownloadIcon />} onClick={handleExport} variant="outlined">
              {t('library_catalog.actions.export')}
            </Button>
          </Can>
          <Can permission="library_catalog.books.create">
            <Button startIcon={<AddIcon />} onClick={openCreate} variant="contained">
              {t('library_catalog.actions.add_book')}
            </Button>
          </Can>
        </Stack>
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('library_catalog.fields.title')}</TableCell>
                <TableCell>{t('library_catalog.fields.author')}</TableCell>
                <TableCell>{t('library_catalog.fields.category')}</TableCell>
                <TableCell>{t('library_catalog.fields.total_copies')}</TableCell>
                <TableCell>{t('library_catalog.fields.created_at')}</TableCell>
                <TableCell align="right">{t('core.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(books ?? []).map((book) => (
                <TableRow key={book.id} hover>
                  <TableCell>
                    <RouterLink to={`/library/books/${book.id}`}>{book.title}</RouterLink>
                  </TableCell>
                  <TableCell>{book.author ?? '—'}</TableCell>
                  <TableCell>{book.category ?? '—'}</TableCell>
                  <TableCell>{book.totalCopies ?? 0}</TableCell>
                  <TableCell>{formatDateOnly(book.createdAt, language)}</TableCell>
                  <TableCell align="right">
                    <Can permission="library_catalog.books.update">
                      <IconButton size="small" onClick={() => openEdit(book)} aria-label={t('core.common.edit')}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Can>
                    <Can permission="library_catalog.books.delete">
                      <IconButton size="small" onClick={() => setPendingDelete(book)} aria-label={t('core.common.delete')}>
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

      <BookFormDialog open={formOpen} book={editingBook} onClose={() => setFormOpen(false)} onSubmit={handleSubmit} />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('library_catalog.books.delete_title')}
        description={t('library_catalog.books.delete_confirm', { title: pendingDelete?.title ?? '' })}
        confirmLabel={t('core.common.delete')}
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />

      <Snackbar open={snackbar !== null} autoHideDuration={5000} onClose={() => setSnackbar(null)}>
        <Alert severity="error" onClose={() => setSnackbar(null)}>
          {snackbar}
        </Alert>
      </Snackbar>
    </Box>
  );
}
