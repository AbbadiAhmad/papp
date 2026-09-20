import AddIcon from '@mui/icons-material/Add';
import PaidIcon from '@mui/icons-material/Paid';
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
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../../../apps/web/src/shared/components/ConfirmDialog';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { libraryCirculationApi, type FineStatus, type LibraryFine, type LibraryFineType, type PaymentMethod, type StudentSearchResult } from '../api';
import { ReaderAutocomplete } from './ReaderAutocomplete';

const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'transfer'];

const STATUS_COLOR: Record<FineStatus, 'error' | 'warning' | 'success' | 'default'> = {
  unpaid: 'error',
  partially_paid: 'warning',
  paid: 'success',
  waived: 'default',
  cancelled: 'default',
};

/** §11-13: fines list + waive + record-payment — the finance side lives here since library_finance is combined into this module (D44). */
export function FinesPage() {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const { status, data: fines, errorMessage, reload } = useGuardedQuery(() =>
    libraryCirculationApi.listFines(),
  );

  const [pendingWaive, setPendingWaive] = useState<LibraryFine | null>(null);
  const [payingFine, setPayingFine] = useState<LibraryFine | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const handleWaive = async () => {
    if (!pendingWaive) return;
    try {
      await gated('library_circulation.fines.waive', () => libraryCirculationApi.waiveFine(pendingWaive.id));
      reload();
    } catch (error) {
      setSnackbar(extractErrorMessage(error));
    } finally {
      setPendingWaive(null);
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h4" component="h2">
          {t('library_circulation.menu.fines')}
        </Typography>
        <Can permission="library_circulation.fines.record">
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => setCreateOpen(true)}>
            {t('library_circulation.fines.create_button')}
          </Button>
        </Can>
      </Stack>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('library_circulation.fines.fine_number')}</TableCell>
                <TableCell>{t('library_circulation.fines.amount')}</TableCell>
                <TableCell>{t('library_circulation.fines.amount_paid')}</TableCell>
                <TableCell>{t('library_circulation.fines.status')}</TableCell>
                <TableCell align="right">{t('core.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(fines ?? []).map((fine) => (
                <TableRow key={fine.id} hover>
                  <TableCell>{fine.fineNumber}</TableCell>
                  <TableCell>{fine.amount}</TableCell>
                  <TableCell>{fine.amountPaid}</TableCell>
                  <TableCell>
                    <Chip size="small" color={STATUS_COLOR[fine.status]} label={t(`library_circulation.fine_status.${fine.status}`)} />
                  </TableCell>
                  <TableCell align="right">
                    <Can permission="library_circulation.finance.record_payment">
                      {fine.status === 'unpaid' || fine.status === 'partially_paid' ? (
                        <Tooltip title={t('library_circulation.fines.record_payment')}>
                          <IconButton size="small" onClick={() => setPayingFine(fine)}>
                            <PaidIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : null}
                    </Can>
                    <Can permission="library_circulation.fines.waive">
                      {fine.status !== 'paid' && fine.status !== 'waived' ? (
                        <Button size="small" onClick={() => setPendingWaive(fine)}>
                          {t('library_circulation.fines.waive')}
                        </Button>
                      ) : null}
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </QueryStateGate>

      <ConfirmDialog
        open={pendingWaive !== null}
        title={t('library_circulation.fines.waive')}
        description={t('library_circulation.fines.waive_confirm')}
        confirmLabel={t('library_circulation.fines.waive')}
        confirmColor="error"
        onCancel={() => setPendingWaive(null)}
        onConfirm={handleWaive}
      />

      <PaymentDialog
        fine={payingFine}
        onClose={() => setPayingFine(null)}
        onPaid={() => {
          setPayingFine(null);
          reload();
        }}
      />

      <CreateFineDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          reload();
        }}
      />

      <Snackbar open={snackbar !== null} autoHideDuration={4000} onClose={() => setSnackbar(null)} message={snackbar} />
    </Box>
  );
}

/** [Add fine] button's dialog — the reader is picked via the searchable ReaderAutocomplete, not scanned/pre-supplied. */
function CreateFineDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [student, setStudent] = useState<StudentSearchResult | null>(null);
  const [fineTypes, setFineTypes] = useState<LibraryFineType[]>([]);
  const [fineTypeId, setFineTypeId] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStudent(null);
    setFineTypeId('');
    setAmount('');
    setNotes('');
    setError(null);
    libraryCirculationApi.listFineTypes().then((types) => {
      setFineTypes(types);
      if (types[0]) {
        setFineTypeId(types[0].id);
        setAmount(types[0].defaultAmount);
      }
    });
  }, [open]);

  const handleFineTypeChange = (id: string) => {
    setFineTypeId(id);
    const match = fineTypes.find((ft) => ft.id === id);
    if (match) setAmount(match.defaultAmount);
  };

  const handleSubmit = async () => {
    if (!student) return;
    setError(null);
    setSubmitting(true);
    try {
      await gated('library_circulation.fines.record', () =>
        libraryCirculationApi.createFine({
          studentId: student.id,
          fineTypeId,
          amount: Number(amount),
          notes: notes || undefined,
        }),
      );
      onCreated();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('library_circulation.fines.create_title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <ReaderAutocomplete value={student} onChange={setStudent} autoFocus />
          <TextField
            select
            label={t('library_circulation.fines.fine_type')}
            value={fineTypeId}
            onChange={(e) => handleFineTypeChange(e.target.value)}
          >
            {fineTypes.map((ft) => (
              <MenuItem key={ft.id} value={ft.id}>
                {ft.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('library_circulation.fines.amount')}
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <TextField
            label={t('library_circulation.return.notes')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            minRows={2}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {t('core.common.cancel')}
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting || !student || !fineTypeId || !amount}>
          {t('core.common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PaymentDialog({ fine, onClose, onPaid }: { fine: LibraryFine | null; onClose: () => void; onPaid: () => void }) {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!fine) return null;
  const remaining = Number(fine.amount) - Number(fine.amountPaid);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await gated('library_circulation.finance.record_payment', () =>
        libraryCirculationApi.recordPayment(fine.id, Number(amount), paymentMethod),
      );
      setAmount('');
      onPaid();
    } catch (submitError) {
      setError(extractErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={fine !== null} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('library_circulation.fines.record_payment')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Typography variant="body2" color="text.secondary">
            {t('library_circulation.fines.remaining_balance', { amount: remaining.toFixed(2) })}
          </Typography>
          <TextField
            label={t('library_circulation.fines.amount')}
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
          <TextField
            select
            label={t('library_circulation.finance.payment_method')}
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
          >
            {PAYMENT_METHODS.map((method) => (
              <MenuItem key={method} value={method}>
                {t(`library_circulation.finance.payment_method.${method}`)}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {t('core.common.cancel')}
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting || !amount}>
          {t('core.common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
