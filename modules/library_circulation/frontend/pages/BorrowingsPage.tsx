import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  FormControlLabel,
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
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { libraryCirculationApi, readerLabel, type BorrowingFilterInput, type BorrowingStatus } from '../api';

const BORROWING_STATUSES: BorrowingStatus[] = ['active', 'returned', 'overdue', 'lost', 'cancelled'];

const STATUS_COLOR: Record<BorrowingStatus, 'default' | 'success' | 'error' | 'warning'> = {
  active: 'default',
  returned: 'success',
  overdue: 'error',
  lost: 'error',
  cancelled: 'default',
};

/**
 * Reads the initial filter off the URL's own query string — lets the
 * dashboard's `overdueBorrowings`/`borrowedCopies` cards deep-link straight
 * into a pre-filtered view (same "?filter=... in the URL" pattern
 * FinesPage.tsx already established, root bug-fix LIBRARY_CIRCULATION-D32).
 */
function filterFromSearchParams(searchParams: URLSearchParams): BorrowingFilterInput {
  return {
    status: (searchParams.get('status') as BorrowingStatus | null) ?? '',
    overdueOnly: searchParams.get('overdueOnly') === 'true',
    borrowedFrom: searchParams.get('borrowedFrom') ?? undefined,
    borrowedTo: searchParams.get('borrowedTo') ?? undefined,
  };
}

/**
 * Borrowings status page (user request: "a page to track borrowed book
 * status. as a table, book name, borrowing reader, date of borrow,
 * estimated date of return, overdue by days") — the circulation module's
 * previously-missing "list every borrowing" screen; closes the dashboard's
 * `borrowedCopies`/`overdueBorrowings` cards' own "no destination page"
 * gap flagged in LIBRARY_CIRCULATION-D32.
 */
export function BorrowingsPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialFilter = filterFromSearchParams(searchParams);
  const [filter, setFilter] = useState<BorrowingFilterInput>(initialFilter);
  const [appliedFilter, setAppliedFilter] = useState<BorrowingFilterInput>(initialFilter);

  const { status, data, errorMessage, reload } = useGuardedQuery(() => libraryCirculationApi.listBorrowings(appliedFilter));

  const handleFieldChange = (field: keyof BorrowingFilterInput, value: string | boolean) => {
    setFilter((prev) => ({ ...prev, [field]: value }));
  };

  const syncSearchParams = (applied: BorrowingFilterInput) => {
    const next = new URLSearchParams();
    if (applied.status) next.set('status', applied.status);
    if (applied.overdueOnly) next.set('overdueOnly', 'true');
    if (applied.borrowedFrom) next.set('borrowedFrom', applied.borrowedFrom);
    if (applied.borrowedTo) next.set('borrowedTo', applied.borrowedTo);
    setSearchParams(next, { replace: true });
  };

  // useGuardedQuery only re-fetches on an explicit reload() (reads its
  // fetcher through a ref, not a dependency array) — a filter change needs
  // its own reload() call, not just a state update (same pattern FinesPage
  // already uses).
  const applyFilters = () => {
    setAppliedFilter(filter);
    syncSearchParams(filter);
    reload();
  };
  const clearFilters = () => {
    const empty: BorrowingFilterInput = {};
    setFilter(empty);
    setAppliedFilter(empty);
    syncSearchParams(empty);
    reload();
  };

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('library_circulation.menu.borrowings')}
      </Typography>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Grid container spacing={2} sx={{ alignItems: 'center' }}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                select
                label={t('library_circulation.borrowings.status')}
                value={filter.status ?? ''}
                onChange={(e) => handleFieldChange('status', e.target.value)}
                fullWidth
              >
                <MenuItem value="">{t('library_circulation.finance.filter_any_status')}</MenuItem>
                {BORROWING_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {t(`library_circulation.borrowing_status.${s}`)}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                label={t('library_circulation.finance.filter_date_from')}
                type="date"
                value={filter.borrowedFrom ?? ''}
                onChange={(e) => handleFieldChange('borrowedFrom', e.target.value)}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                label={t('library_circulation.finance.filter_date_to')}
                type="date"
                value={filter.borrowedTo ?? ''}
                onChange={(e) => handleFieldChange('borrowedTo', e.target.value)}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={filter.overdueOnly ?? false}
                    onChange={(e) => handleFieldChange('overdueOnly', e.target.checked)}
                  />
                }
                label={t('library_circulation.borrowings.overdue_only')}
              />
            </Grid>
            <Grid size={12}>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                <Button variant="contained" onClick={applyFilters}>
                  {t('library_circulation.finance.apply_filters')}
                </Button>
                <Button onClick={clearFilters}>{t('library_circulation.finance.clear_filters')}</Button>
              </Stack>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('library_circulation.borrowings.book_title')}</TableCell>
                <TableCell>{t('library_circulation.reader_picker.label')}</TableCell>
                <TableCell>{t('library_circulation.borrowings.borrowed_at')}</TableCell>
                <TableCell>{t('library_circulation.borrowings.due_at')}</TableCell>
                <TableCell>{t('library_circulation.borrowings.days_overdue')}</TableCell>
                <TableCell>{t('library_circulation.borrowings.status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data ?? []).map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>{row.bookTitle ?? row.qrCode ?? '—'}</TableCell>
                  <TableCell>{readerLabel(row.studentName, row.studentCode)}</TableCell>
                  <TableCell>{formatDateOnly(row.borrowedAt, language)}</TableCell>
                  <TableCell>{formatDateOnly(row.dueAt, language)}</TableCell>
                  <TableCell>
                    {row.daysOverdue > 0 ? (
                      <Chip size="small" color="error" label={row.daysOverdue} />
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={STATUS_COLOR[row.status]} label={t(`library_circulation.borrowing_status.${row.status}`)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </QueryStateGate>
    </Box>
  );
}
