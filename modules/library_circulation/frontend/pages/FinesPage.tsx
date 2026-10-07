import AddIcon from '@mui/icons-material/Add';
import PaidIcon from '@mui/icons-material/Paid';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  Link,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
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
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { ConfirmDialog } from '../../../../apps/web/src/shared/components/ConfirmDialog';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { formatDateOnly, formatDateTime } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { Can, useGatedCall, usePermission } from '../../../../apps/web/src/shared/permissions';
import {
  libraryCirculationApi,
  type FineFilterInput,
  type FineStatus,
  type LibraryFine,
  type LibraryFineDetail,
  type LibraryFineType,
  type PaymentMethod,
  type StudentSearchResult,
} from '../api';
import { ReaderLink } from './ReaderLink';
import { ReaderAutocomplete } from './ReaderAutocomplete';

const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'transfer'];
const FINE_STATUSES: FineStatus[] = ['unpaid', 'partially_paid', 'paid', 'waived', 'cancelled'];

const STATUS_COLOR: Record<FineStatus, 'error' | 'warning' | 'success' | 'default'> = {
  unpaid: 'error',
  partially_paid: 'warning',
  paid: 'success',
  waived: 'default',
  cancelled: 'default',
};

const EMPTY_FINE_FILTER: FineFilterInput = {
  studentId: undefined,
  status: [],
  fineTypeId: '',
  dateFrom: '',
  dateTo: '',
  createdByName: '',
  amountMin: undefined,
  amountMax: undefined,
};

/**
 * Reads the initial filter off the URL's own query string — lets the
 * dashboard (and anywhere else) deep-link straight into a pre-filtered
 * view, e.g. `?status=unpaid,partially_paid` for the "Unpaid fines" card,
 * same "?filter=... in the URL" pattern reading_club's own
 * ReadersListPage/DashboardPage already use for groupId/stageId.
 */
function filterFromSearchParams(searchParams: URLSearchParams): FineFilterInput {
  const statusParam = searchParams.get('status');
  const status = statusParam ? (statusParam.split(',').filter(Boolean) as FineStatus[]) : [];
  return {
    ...EMPTY_FINE_FILTER,
    status,
    studentId: searchParams.get('studentId') ?? undefined,
  };
}

/** §11-13: fines list + filters + waive + record-payment — the finance side lives here since library_finance is combined into this module (D44). */
export function FinesPage() {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialFilter = filterFromSearchParams(searchParams);
  const [filterStudent, setFilterStudent] = useState<StudentSearchResult | null>(null);
  const [filter, setFilter] = useState<FineFilterInput>(initialFilter);
  const [appliedFilter, setAppliedFilter] = useState<FineFilterInput>(initialFilter);
  const [fineTypes, setFineTypes] = useState<LibraryFineType[]>([]);

  useEffect(() => {
    libraryCirculationApi.listFineTypes().then(setFineTypes);
  }, []);

  // A `studentId` arriving via the URL (e.g. a future deep-link from a
  // reader's own detail page) has no display name/code yet — resolve it
  // once so the ReaderAutocomplete shows more than a blank field.
  useEffect(() => {
    if (!initialFilter.studentId) return;
    libraryCirculationApi
      .getStudent(initialFilter.studentId)
      .then((student) => setFilterStudent({ id: student.id, userId: student.userId, code: student.code, className: student.className, name: student.name }))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only resolution of the URL's initial studentId.
  }, []);

  const { status, data, errorMessage, reload } = useGuardedQuery(() => libraryCirculationApi.listFines(appliedFilter));

  const [pendingWaive, setPendingWaive] = useState<LibraryFine | null>(null);
  const [payingFine, setPayingFine] = useState<LibraryFine | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailFineId, setDetailFineId] = useState<string | null>(null);
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

  const handleFieldChange = (field: Exclude<keyof FineFilterInput, 'status'>, value: string) => {
    setFilter((prev) => ({ ...prev, [field]: value }));
  };
  const handleStatusChange = (value: FineStatus[]) => {
    setFilter((prev) => ({ ...prev, status: value }));
  };

  /** Keeps the URL's own query string in sync with what's actually applied, so the page's current view is always a shareable/bookmarkable/back-button-safe link. */
  const syncSearchParams = (applied: FineFilterInput) => {
    const next = new URLSearchParams();
    if (applied.status && applied.status.length > 0) next.set('status', applied.status.join(','));
    if (applied.studentId) next.set('studentId', applied.studentId);
    setSearchParams(next, { replace: true });
  };

  // useGuardedQuery only re-fetches on an explicit reload() (reads its
  // fetcher through a ref, not a dependency array) — a filter change needs
  // its own reload() call, not just a state update.
  const applyFilters = () => {
    const applied = { ...filter, studentId: filterStudent?.id };
    setAppliedFilter(applied);
    syncSearchParams(applied);
    reload();
  };
  const clearFilters = () => {
    setFilterStudent(null);
    setFilter(EMPTY_FINE_FILTER);
    setAppliedFilter(EMPTY_FINE_FILTER);
    syncSearchParams(EMPTY_FINE_FILTER);
    reload();
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

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Grid container spacing={2} sx={{ alignItems: 'center' }}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <ReaderAutocomplete value={filterStudent} onChange={setFilterStudent} label={t('library_circulation.fines.filter_reader')} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <FormControl fullWidth>
                <InputLabel id="fines-status-filter-label">{t('library_circulation.fines.status')}</InputLabel>
                <Select
                  multiple
                  labelId="fines-status-filter-label"
                  input={<OutlinedInput label={t('library_circulation.fines.status')} />}
                  value={filter.status ?? []}
                  onChange={(e) => {
                    const value = e.target.value;
                    handleStatusChange(typeof value === 'string' ? (value.split(',') as FineStatus[]) : value);
                  }}
                  renderValue={(selected) =>
                    selected.length === 0
                      ? t('library_circulation.fines.filter_any_status')
                      : selected.map((s) => t(`library_circulation.fine_status.${s}`)).join(', ')
                  }
                  displayEmpty
                >
                  {FINE_STATUSES.map((s) => (
                    <MenuItem key={s} value={s}>
                      <Checkbox size="small" checked={(filter.status ?? []).includes(s)} />
                      <ListItemText primary={t(`library_circulation.fine_status.${s}`)} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                select
                label={t('library_circulation.fines.fine_type')}
                value={filter.fineTypeId}
                onChange={(e) => handleFieldChange('fineTypeId', e.target.value)}
                fullWidth
              >
                <MenuItem value="">{t('library_circulation.fines.filter_any_fine_type')}</MenuItem>
                {fineTypes.map((ft) => (
                  <MenuItem key={ft.id} value={ft.id}>
                    {ft.name}
                  </MenuItem>
                ))}
              </TextField>
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
                label={t('library_circulation.fines.filter_amount_min')}
                type="number"
                value={filter.amountMin ?? ''}
                onChange={(e) => handleFieldChange('amountMin', e.target.value)}
                fullWidth
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                label={t('library_circulation.fines.filter_amount_max')}
                type="number"
                value={filter.amountMax ?? ''}
                onChange={(e) => handleFieldChange('amountMax', e.target.value)}
                fullWidth
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
                <TableCell>{t('library_circulation.fines.fine_number')}</TableCell>
                <TableCell>{t('library_circulation.reader_picker.label')}</TableCell>
                <TableCell>{t('library_circulation.fines.fine_type')}</TableCell>
                <TableCell>{t('library_circulation.fines.amount')}</TableCell>
                <TableCell>{t('library_circulation.fines.amount_paid')}</TableCell>
                <TableCell>{t('library_circulation.fines.status')}</TableCell>
                <TableCell>{t('library_circulation.fines.recorded_by')}</TableCell>
                <TableCell align="right">{t('core.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.fines ?? []).map((fine) => (
                <TableRow key={fine.id} hover>
                  <TableCell>
                    <Link component="button" onClick={() => setDetailFineId(fine.id)}>
                      {fine.fineNumber}
                    </Link>
                  </TableCell>
                  <TableCell><ReaderLink readerId={fine.studentId} name={fine.studentName} code={fine.studentCode} /></TableCell>
                  <TableCell>{fine.fineTypeName ?? '—'}</TableCell>
                  <TableCell>{fine.amount}</TableCell>
                  <TableCell>{fine.amountPaid}</TableCell>
                  <TableCell>
                    <Chip size="small" color={STATUS_COLOR[fine.status]} label={t(`library_circulation.fine_status.${fine.status}`)} />
                  </TableCell>
                  <TableCell>{fine.createdByName ?? '—'}</TableCell>
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

      {data ? (
        <Typography variant="subtitle1" sx={{ textAlign: 'end', mt: 1 }}>
          {t('library_circulation.finance.filtered_total', { amount: data.totalAmount.toFixed(2) })}
        </Typography>
      ) : null}

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

      <FineDetailDialog
        fineId={detailFineId}
        onClose={() => setDetailFineId(null)}
        onChanged={() => reload()}
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

/**
 * Fine detail: book/return context (title, status, days late), who
 * recorded it and who received each payment, and — the two things
 * previously missing entirely — an editable amount/notes. Editing is
 * gated by TWO different permissions depending on the fine's current
 * status: `fines.record` while still unpaid/partially_paid (the same
 * permission that creates a fine), or the more privileged
 * `fines.update_after_payment` once it's fully paid. A waived/cancelled
 * fine is never editable — it's already a closed/void record.
 */
function FineDetailDialog({ fineId, onClose, onChanged }: { fineId: string | null; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const gated = useGatedCall();
  const canRecord = usePermission('library_circulation.fines.record');
  const canUpdateAfterPayment = usePermission('library_circulation.fines.update_after_payment');
  const [fine, setFine] = useState<LibraryFineDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    if (!fineId) return;
    setLoading(true);
    libraryCirculationApi
      .getFine(fineId)
      .then((result) => {
        setFine(result);
        setAmount(result.amount);
        setNotes(result.notes ?? '');
      })
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setFine(null);
    setEditing(false);
    setError(null);
    if (fineId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fineId]);

  if (!fineId) return null;

  const canEdit = fine ? (fine.status === 'paid' ? canUpdateAfterPayment : (fine.status === 'unpaid' || fine.status === 'partially_paid') && canRecord) : false;

  const handleSave = async () => {
    if (!fine) return;
    setError(null);
    setSubmitting(true);
    try {
      const dto = { amount: Number(amount), notes: notes || undefined };
      if (fine.status === 'paid') {
        await gated('library_circulation.fines.update_after_payment', () => libraryCirculationApi.updateFineAfterPayment(fine.id, dto));
      } else {
        await gated('library_circulation.fines.record', () => libraryCirculationApi.updateFine(fine.id, dto));
      }
      setEditing(false);
      load();
      onChanged();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={fineId !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{fine?.fineNumber ?? t('library_circulation.fines.create_title')}</DialogTitle>
      <DialogContent>
        {loading || !fine ? (
          <Typography variant="body2" color="text.secondary">
            {t('core.common.loading')}
          </Typography>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}

            {/* Book / return context — the "why does this fine exist" a raw fine row can't show. */}
            {fine.borrowingContext ? (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  {t('library_circulation.scan.book_label')}
                </Typography>
                <Typography variant="body2">{fine.borrowingContext.bookTitle ?? fine.borrowingContext.qrCode ?? '—'}</Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                  {fine.borrowingContext.returnStatus ? (
                    <Chip size="small" label={t(`library_circulation.return.status_${fine.borrowingContext.returnStatus}`)} />
                  ) : null}
                  <Chip
                    size="small"
                    color={fine.borrowingContext.daysLate > 0 ? 'error' : 'default'}
                    label={`${t('library_circulation.return.days_late')}: ${fine.borrowingContext.daysLate}`}
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`${t('library_circulation.borrowings.due_at')}: ${formatDateOnly(fine.borrowingContext.dueAt, language)}`}
                  />
                  {fine.borrowingContext.returnedAt ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`${t('library_circulation.borrowings.returned_at')}: ${formatDateOnly(fine.borrowingContext.returnedAt, language)}`}
                    />
                  ) : null}
                </Stack>
                <Divider sx={{ mt: 2 }} />
              </Box>
            ) : null}

            {/* Amount / notes — editable when the current status + the viewer's permission allow it. */}
            {editing ? (
              <Stack spacing={2}>
                <TextField
                  label={t('library_circulation.fines.amount')}
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                />
                <TextField
                  label={t('library_circulation.return.notes')}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  multiline
                  minRows={2}
                />
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" onClick={handleSave} disabled={submitting || !amount}>
                    {t('core.common.save')}
                  </Button>
                  <Button onClick={() => setEditing(false)} disabled={submitting}>
                    {t('core.common.cancel')}
                  </Button>
                </Stack>
              </Stack>
            ) : (
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="body1">
                    {t('library_circulation.fines.amount')}: {fine.amount}
                  </Typography>
                  {canEdit ? (
                    <Button size="small" onClick={() => setEditing(true)}>
                      {t('core.common.edit')}
                    </Button>
                  ) : null}
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {t('library_circulation.fines.amount_paid')}: {fine.amountPaid}
                </Typography>
                {fine.notes ? <Typography variant="body2">{fine.notes}</Typography> : null}
                <Chip size="small" color={STATUS_COLOR[fine.status]} label={t(`library_circulation.fine_status.${fine.status}`)} sx={{ alignSelf: 'flex-start' }} />
              </Stack>
            )}

            <Divider />

            {/* Who recorded it, and who closed it by recording each payment. */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {t('library_circulation.fines.recorded_by')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {fine.createdByName ?? '—'} · {formatDateTime(fine.createdAt, language)}
              </Typography>
            </Box>

            {fine.payments.length > 0 ? (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  {t('library_circulation.fines.payments_title')}
                </Typography>
                <List dense disablePadding>
                  {fine.payments.map((payment) => (
                    <ListItem key={payment.id} disableGutters>
                      <ListItemText
                        primary={`${payment.amount} (${t(`library_circulation.finance.payment_method.${payment.paymentMethod}`)})`}
                        secondary={`${payment.receivedByName ?? '—'} · ${formatDateTime(payment.paidAt, language)}`}
                      />
                    </ListItem>
                  ))}
                </List>
              </Box>
            ) : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('core.common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
