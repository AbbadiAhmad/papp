import DownloadIcon from '@mui/icons-material/Download';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  MenuItem,
  Paper,
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
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { downloadBlob, libraryCatalogApi, type BookCopyStatus, type CopyForInventory } from '../api';

const COPY_STATUSES: BookCopyStatus[] = ['available', 'borrowed', 'lost', 'damaged', 'maintenance', 'reserved'];

const STATUS_COLOR: Record<BookCopyStatus, 'success' | 'default' | 'error' | 'warning'> = {
  available: 'success',
  borrowed: 'default',
  reserved: 'default',
  lost: 'error',
  damaged: 'error',
  maintenance: 'warning',
};

/**
 * Copies inventory page (user request: "a page to show the available
 * copies, (book name, copy code, location, status,..) on the library
 * module to help the librarian on the Annual inventory"). Filters by
 * status/location/book title; the full list loads on mount so the page
 * isn't empty before the librarian picks a filter (same pattern
 * PrintCodesPage.tsx already established for its own date-range filter).
 */
export function CopiesInventoryPage() {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [bookSearch, setBookSearch] = useState('');
  const [status, setStatus] = useState<BookCopyStatus | ''>('');
  const [location, setLocation] = useState('');
  const [copies, setCopies] = useState<CopyForInventory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await libraryCatalogApi.listCopiesForInventory({
        bookSearch: bookSearch || undefined,
        status: status || undefined,
        location: location || undefined,
      });
      setCopies(result);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only load; runSearch itself reads the latest filter fields when called from the Apply button.
  }, []);

  const clearFilters = () => {
    setBookSearch('');
    setStatus('');
    setLocation('');
    setError(null);
    setLoading(true);
    libraryCatalogApi
      .listCopiesForInventory({})
      .then(setCopies)
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  };

  const handleExport = async () => {
    setError(null);
    try {
      const blob = await gated('library_catalog.copies.inventory', () =>
        libraryCatalogApi.exportCopiesForInventory({
          bookSearch: bookSearch || undefined,
          status: status || undefined,
          location: location || undefined,
        }),
      );
      downloadBlob(blob, 'library-catalog-copies-inventory-export.xlsx');
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('library_catalog.menu.inventory')}
      </Typography>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          ) : null}
          <Grid container spacing={2} sx={{ alignItems: 'center' }}>
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <TextField
                label={t('library_catalog.fields.title')}
                value={bookSearch}
                onChange={(e) => setBookSearch(e.target.value)}
                fullWidth
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <TextField
                select
                label={t('library_catalog.copies.status')}
                value={status}
                onChange={(e) => setStatus(e.target.value as BookCopyStatus | '')}
                fullWidth
              >
                <MenuItem value="">{t('library_catalog.inventory.filter_any_status')}</MenuItem>
                {COPY_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {t(`library_catalog.copy_status.${s}`)}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <TextField
                label={t('library_catalog.copies.location')}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                fullWidth
              />
            </Grid>
            <Grid size={12}>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                <Button variant="contained" onClick={runSearch} disabled={loading}>
                  {t('library_catalog.print_codes.filter_button')}
                </Button>
                <Button onClick={clearFilters} disabled={loading}>
                  {t('library_catalog.inventory.clear_filters')}
                </Button>
                <Can permission="library_catalog.copies.inventory">
                  <Button startIcon={<DownloadIcon />} onClick={handleExport} disabled={loading}>
                    {t('library_catalog.actions.export')}
                  </Button>
                </Can>
              </Stack>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('library_catalog.fields.title')}</TableCell>
              <TableCell>{t('library_catalog.copies.qr_code')}</TableCell>
              <TableCell>{t('library_catalog.copies.location')}</TableCell>
              <TableCell>{t('library_catalog.copies.status')}</TableCell>
              <TableCell>{t('library_catalog.copies.condition')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {copies.map((copy) => (
              <TableRow key={copy.id} hover>
                <TableCell>{copy.bookTitle}</TableCell>
                <TableCell>{copy.qrCode}</TableCell>
                <TableCell>{copy.location ?? '—'}</TableCell>
                <TableCell>
                  <Chip size="small" color={STATUS_COLOR[copy.status]} label={t(`library_catalog.copy_status.${copy.status}`)} />
                </TableCell>
                <TableCell>{copy.condition ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
