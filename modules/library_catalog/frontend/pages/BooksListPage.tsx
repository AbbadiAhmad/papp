import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  IconButton,
  ListItemText,
  MenuItem,
  Paper,
  Rating,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { ConfirmDialog } from '../../../../apps/web/src/shared/components/ConfirmDialog';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { extractErrorMessage, isForbiddenError } from '../../../../apps/web/src/shared/api/httpClient';
import { useGatedCall, Can } from '../../../../apps/web/src/shared/permissions';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { downloadBlob, libraryCatalogApi, type BookCopyStatus, type CreateBookInput, type LibraryBook, type UpdateBookInput } from '../api';
import { BookFormDialog } from './BookFormDialog';

const COPY_STATUS_OPTIONS: BookCopyStatus[] = ['available', 'borrowed', 'damaged', 'lost', 'maintenance', 'reserved'];

const COPY_STATUS_COLOR: Record<BookCopyStatus, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  available: 'success',
  borrowed: 'info',
  lost: 'error',
  damaged: 'warning',
  maintenance: 'default',
  reserved: 'default',
};

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
const MAX_CODES_SHOWN = 4;

/** A book's copy codes as chips (max 4, then "+N"); each opens the book page at that copy. */
function BookCodes({ book }: { book: LibraryBook }) {
  const codes = book.copyCodes ?? [];
  const matching = new Set((book.matchingCopies ?? []).map((c) => c.id));
  const filtering = book.matchingCopies !== undefined;
  // When filtering, matching copies come first so they are never hidden behind "+N".
  const ordered = filtering ? [...codes].sort((a, b) => Number(matching.has(b.id)) - Number(matching.has(a.id))) : codes;
  const shown = ordered.slice(0, MAX_CODES_SHOWN);
  const { t } = useTranslation();
  if (codes.length === 0) return <>—</>;
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5, alignItems: 'center' }}>
      {shown.map((copy) => {
        const isMatch = matching.has(copy.id);
        return (
          <Chip
            key={copy.id}
            size="small"
            clickable
            component={RouterLink}
            to={`/library/books/${book.id}?copy=${copy.id}`}
            variant={filtering && !isMatch ? 'outlined' : 'filled'}
            color={filtering ? (isMatch ? COPY_STATUS_COLOR[copy.status] : 'default') : 'default'}
            title={t(`library_catalog.copy_status.${copy.status}`)}
            label={filtering && isMatch ? `${copy.qrCode} · ${t(`library_catalog.copy_status.${copy.status}`)}` : copy.qrCode}
          />
        );
      })}
      {ordered.length > shown.length ? (
        <RouterLink to={`/library/books/${book.id}`}>+{ordered.length - shown.length}</RouterLink>
      ) : null}
    </Stack>
  );
}

export function BooksListPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const gated = useGatedCall();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [copyStatuses, setCopyStatuses] = useState<BookCopyStatus[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [books, setBooks] = useState<LibraryBook[] | undefined>(undefined);
  const [status, setStatus] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const reload = () => setReloadToken((n) => n + 1);

  // Tab 1 is simply the "damaged or lost" preset of the status filter — the filter stays the one source of truth.
  const needsAttention = copyStatuses.length === 2 && copyStatuses.includes('damaged') && copyStatuses.includes('lost');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    libraryCatalogApi
      .listBooks({ search: debouncedSearch || undefined, copyStatus: copyStatuses })
      .then((data) => {
        if (cancelled) return;
        setBooks(data);
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
  }, [debouncedSearch, copyStatuses, reloadToken]);

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
            sx={{ minWidth: 220 }}
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

      <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Tabs
          value={needsAttention ? 'attention' : 'all'}
          onChange={(_e, value) => setCopyStatuses(value === 'attention' ? ['damaged', 'lost'] : [])}
          aria-label={t('library_catalog.filters.tabs_label')}
        >
          <Tab value="all" label={t('library_catalog.filters.tab_all')} />
          <Tab value="attention" label={t('library_catalog.filters.tab_damaged_lost')} />
        </Tabs>
        <TextField
          select
          size="small"
          label={t('library_catalog.filters.copy_status')}
          value={copyStatuses}
          onChange={(e) => setCopyStatuses(typeof e.target.value === 'string' ? (e.target.value.split(',') as BookCopyStatus[]) : (e.target.value as BookCopyStatus[]))}
          sx={{ minWidth: 240 }}
          slotProps={{
            select: {
              multiple: true,
              renderValue: (selected) =>
                (selected as BookCopyStatus[]).length === 0
                  ? t('library_catalog.filters.any_status')
                  : (selected as BookCopyStatus[]).map((v) => t(`library_catalog.copy_status.${v}`)).join(', '),
              displayEmpty: true,
            },
          }}
        >
          {COPY_STATUS_OPTIONS.map((option) => (
            <MenuItem key={option} value={option}>
              <Checkbox checked={copyStatuses.includes(option)} size="small" />
              <ListItemText primary={t(`library_catalog.copy_status.${option}`)} />
            </MenuItem>
          ))}
        </TextField>
        {copyStatuses.length > 0 ? <Button onClick={() => setCopyStatuses([])}>{t('library_catalog.filters.clear')}</Button> : null}
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('library_catalog.fields.title')}</TableCell>
                <TableCell>{t('library_catalog.fields.author')}</TableCell>
                <TableCell>{t('library_catalog.fields.category')}</TableCell>
                <TableCell>{t('library_catalog.ratings.title')}</TableCell>
                <TableCell>{t('library_catalog.copies.qr_code')}</TableCell>
                <TableCell>{t('library_catalog.fields.total_copies')}</TableCell>
                <TableCell>{t('library_catalog.filters.copy_status')}</TableCell>
                <TableCell>{t('library_catalog.fields.created_at')}</TableCell>
                <TableCell align="right">{t('core.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(books ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    {t('library_catalog.filters.no_results')}
                  </TableCell>
                </TableRow>
              ) : null}
              {(books ?? []).map((book) => (
                <TableRow key={book.id} hover>
                  <TableCell>
                    <RouterLink to={`/library/books/${book.id}`}>{book.title}</RouterLink>
                  </TableCell>
                  <TableCell>{book.author ?? '—'}</TableCell>
                  <TableCell>{book.category ?? '—'}</TableCell>
                  <TableCell>
                    {book.ratingsCount ? (
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <Rating value={book.averageRating ?? 0} precision={0.1} size="small" readOnly />
                        <Typography variant="caption" color="text.secondary">
                          ({book.ratingsCount})
                        </Typography>
                      </Stack>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {t('library_catalog.ratings.none_yet')}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {/* Copy codes (each opens the book at that copy). While a status filter is on, the matching copies are
                        filled and coloured by status; the others stay outlined. */}
                    <BookCodes book={book} />
                  </TableCell>
                  <TableCell>
                    {(book.availableCopies ?? 0)} / {(book.totalCopies ?? 0)}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                      {(Object.entries(book.copyStatusCounts ?? {}) as [BookCopyStatus, number][])
                        .filter(([copyStatus]) => copyStatus !== 'available')
                        .map(([copyStatus, count]) => (
                          <Chip
                            key={copyStatus}
                            size="small"
                            variant="outlined"
                            color={COPY_STATUS_COLOR[copyStatus]}
                            label={`${t(`library_catalog.copy_status.${copyStatus}`)}: ${count}`}
                          />
                        ))}
                    </Stack>
                  </TableCell>
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
