import DownloadIcon from '@mui/icons-material/Download';
import {
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { formatDateOnly, formatDateTime } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { downloadBlob, libraryCirculationApi, type PaymentFilterInput } from '../api';
import { ReaderLink } from './ReaderLink';

/** §12-13: the finance side's own read views over transactions/payments. Deep reporting/analytics is a documented follow-up (DECISIONS.md). */
export function FinancePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('library_circulation.menu.finance')}
      </Typography>
      <Tabs value={tab} onChange={(_, v: number) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label={t('library_circulation.finance.transactions_tab')} />
        <Tab label={t('library_circulation.finance.payments_tab')} />
      </Tabs>
      {tab === 0 ? <TransactionsTab /> : null}
      {tab === 1 ? <PaymentsTab /> : null}
    </Box>
  );
}

function TransactionsTab() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { status, data, errorMessage, reload } = useGuardedQuery(() =>
    libraryCirculationApi.listTransactions(),
  );
  return (
    <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('library_circulation.finance.transaction_number')}</TableCell>
              <TableCell>{t('library_circulation.fines.amount')}</TableCell>
              <TableCell>{t('library_circulation.finance.created_at')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(data ?? []).map((tx) => (
              <TableRow key={tx.id}>
                <TableCell>{tx.transactionNumber}</TableCell>
                <TableCell>{tx.amount}</TableCell>
                <TableCell>{formatDateOnly(tx.createdAt, language)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </QueryStateGate>
  );
}

const EMPTY_FILTER: PaymentFilterInput = { dateFrom: '', dateTo: '', createdByName: '', receivedByName: '' };

function PaymentsTab() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [filter, setFilter] = useState<PaymentFilterInput>(EMPTY_FILTER);
  const [appliedFilter, setAppliedFilter] = useState<PaymentFilterInput>(EMPTY_FILTER);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const { status, data, errorMessage, reload } = useGuardedQuery(() => libraryCirculationApi.listPayments(appliedFilter));

  const handleFieldChange = (field: keyof PaymentFilterInput, value: string) => {
    setFilter((prev) => ({ ...prev, [field]: value }));
  };

  // useGuardedQuery only re-fetches on an explicit reload() (it reads the
  // fetcher through a ref, not a dependency array — see its own docblock) —
  // so a filter change needs its own reload() call, not just a state update.
  const applyFilters = () => {
    setAppliedFilter(filter);
    reload();
  };
  const clearFilters = () => {
    setFilter(EMPTY_FILTER);
    setAppliedFilter(EMPTY_FILTER);
    reload();
  };

  const handleExport = async () => {
    setExportError(null);
    setExporting(true);
    try {
      const blob = await libraryCirculationApi.exportPayments(appliedFilter);
      downloadBlob(blob, 'library-circulation-payments-export.xlsx');
    } catch (err) {
      setExportError(extractErrorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Grid container spacing={2} sx={{ alignItems: 'center' }}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                label={t('library_circulation.finance.filter_date_from')}
                type="date"
                value={filter.dateFrom}
                onChange={(e) => handleFieldChange('dateFrom', e.target.value)}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                label={t('library_circulation.finance.filter_date_to')}
                type="date"
                value={filter.dateTo}
                onChange={(e) => handleFieldChange('dateTo', e.target.value)}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                label={t('library_circulation.finance.filter_created_by')}
                value={filter.createdByName}
                onChange={(e) => handleFieldChange('createdByName', e.target.value)}
                fullWidth
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                label={t('library_circulation.finance.filter_received_by')}
                value={filter.receivedByName}
                onChange={(e) => handleFieldChange('receivedByName', e.target.value)}
                fullWidth
              />
            </Grid>
            <Grid size={12}>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                <Button variant="contained" onClick={applyFilters}>
                  {t('library_circulation.finance.apply_filters')}
                </Button>
                <Button onClick={clearFilters}>{t('library_circulation.finance.clear_filters')}</Button>
                <Button startIcon={<DownloadIcon />} onClick={handleExport} disabled={exporting}>
                  {t('library_circulation.finance.export_excel')}
                </Button>
              </Stack>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {exportError ? (
        <Typography variant="body2" color="error">
          {exportError}
        </Typography>
      ) : null}

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('library_circulation.finance.payment_number')}</TableCell>
                <TableCell>{t('library_circulation.fines.fine_number')}</TableCell>
                <TableCell>{t('library_circulation.students.reader')}</TableCell>
                <TableCell>{t('library_circulation.fines.amount')}</TableCell>
                <TableCell>{t('library_circulation.finance.payment_method')}</TableCell>
                <TableCell>{t('library_circulation.finance.paid_at')}</TableCell>
                <TableCell>{t('library_circulation.finance.filter_received_by')}</TableCell>
                <TableCell>{t('library_circulation.finance.filter_created_by')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.payments ?? []).map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell>{payment.paymentNumber}</TableCell>
                  <TableCell>{payment.fineNumber}</TableCell>
                  <TableCell><ReaderLink readerId={payment.studentId} name={payment.studentName} code={payment.studentCode} /></TableCell>
                  <TableCell>{payment.amount}</TableCell>
                  <TableCell>{t(`library_circulation.finance.payment_method.${payment.paymentMethod}`)}</TableCell>
                  <TableCell>{formatDateTime(payment.paidAt, language)}</TableCell>
                  <TableCell>{payment.receivedByName ?? '—'}</TableCell>
                  <TableCell>{payment.createdByName ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </QueryStateGate>

      {data ? (
        <Typography variant="subtitle1" sx={{ textAlign: 'end' }}>
          {t('library_circulation.finance.filtered_total', { amount: data.totalAmount.toFixed(2) })}
        </Typography>
      ) : null}
    </Stack>
  );
}
