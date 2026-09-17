import { Box, Paper, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, Typography } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { libraryCirculationApi } from '../api';

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
  const { status, data, errorMessage, reload } = useGuardedQuery('library_circulation.finance.view', () =>
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

function PaymentsTab() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { status, data, errorMessage, reload } = useGuardedQuery('library_circulation.finance.view', () =>
    libraryCirculationApi.listPayments(),
  );
  return (
    <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('library_circulation.fines.amount')}</TableCell>
              <TableCell>{t('library_circulation.finance.paid_at')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(data ?? []).map((payment) => (
              <TableRow key={payment.id}>
                <TableCell>{payment.amount}</TableCell>
                <TableCell>{formatDateOnly(payment.paidAt, language)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </QueryStateGate>
  );
}
