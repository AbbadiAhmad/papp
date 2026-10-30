import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { Paginated } from '../../../../apps/web/src/shared/components/Paginated';
import { useGatedCall } from '../../../../apps/web/src/shared/permissions';
import {
  libraryCatalogApi,
  type BooksImportReport,
  type ImportAction,
  type ImportBookPlan,
  type ImportCopyPlan,
  type ImportDecisions,
  type ImportFieldDiff,
  type ImportIssue,
} from '../api';

/** What the user decided for one book or copy: write it or not, and which fields (with their final text). */
interface ItemState {
  apply: boolean;
  fields: Record<string, { use: boolean; value: string }>;
}
type States = Record<string, ItemState>;

/** The fields worth showing: everything on a new item, only the differing ones on an existing one. */
const shownFields = (plan: { action: ImportAction; fields: ImportFieldDiff[] }): ImportFieldDiff[] =>
  plan.action === 'create' ? plan.fields : plan.fields.filter((f) => f.differs);

function initialState(plan: { action: ImportAction; fields: ImportFieldDiff[] }): ItemState {
  const fields: ItemState['fields'] = {};
  for (const f of shownFields(plan)) fields[f.field] = { use: !f.locked, value: f.incoming ?? '' };
  return { apply: plan.action === 'create' || plan.action === 'update', fields };
}

function buildStates(report: BooksImportReport): States {
  const states: States = {};
  for (const book of report.books) {
    states[book.key] = initialState(book);
    for (const copy of book.copies) states[copy.key] = initialState(copy);
  }
  return states;
}

function toDecisions(report: BooksImportReport, states: States): ImportDecisions {
  const pick = (state: ItemState) => ({
    apply: state.apply,
    fields: Object.fromEntries(Object.entries(state.fields).filter(([, v]) => v.use).map(([k, v]) => [k, v.value])),
  });
  const books: ImportDecisions['books'] = {};
  for (const book of report.books) {
    books[book.key] = { ...pick(states[book.key]), copies: Object.fromEntries(book.copies.map((c) => [c.key, pick(states[c.key])])) };
  }
  return { books };
}

const ISSUE_SEVERITY = { error: 'error', warning: 'warning', info: 'info' } as const;

function Issues({ issues }: { issues: ImportIssue[] }) {
  if (!issues.length) return null;
  return (
    <Stack spacing={0.5} sx={{ mb: 1 }}>
      {issues.map((issue, index) => (
        <Alert key={`${issue.level}-${index}`} severity={ISSUE_SEVERITY[issue.level]} sx={{ py: 0 }}>
          {issue.message}
        </Alert>
      ))}
    </Stack>
  );
}

function ActionChip({ action }: { action: ImportAction }) {
  const { t } = useTranslation();
  const color = action === 'create' ? 'success' : action === 'update' ? 'info' : action === 'error' ? 'error' : 'default';
  return <Chip size="small" color={color} label={t(`library_catalog.import.action_${action}`)} />;
}

/** One book or copy: the on/off checkbox in the header, and a current-vs-new editor for each field that differs. */
function ItemCard({
  title,
  plan,
  state,
  onChange,
  children,
}: {
  title: string;
  plan: ImportBookPlan | ImportCopyPlan;
  state: ItemState;
  onChange: (next: ItemState) => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const fields = shownFields(plan);
  const blocked = plan.action === 'error' || plan.action === 'unchanged';
  const create = plan.action === 'create';
  const hasProblems = plan.issues.some((i) => i.level !== 'info');

  return (
    <Accordion defaultExpanded={hasProblems || plan.action === 'error'} disableGutters variant="outlined" sx={{ mb: 1 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5, width: '100%' }}>
          <Checkbox
            checked={state.apply && !blocked}
            disabled={blocked}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onChange({ ...state, apply: e.target.checked })}
            slotProps={{ input: { 'aria-label': t('library_catalog.import.apply_item', { title }) } }}
          />
          <Typography sx={{ fontWeight: 600 }}>{title}</Typography>
          <ActionChip action={plan.action} />
          <Typography variant="caption" color="text.secondary">
            {t('library_catalog.import.rows', { rows: plan.rows.join(', ') })}
          </Typography>
          {plan.issues.some((i) => i.level === 'error') ? <Chip size="small" color="error" variant="outlined" label={t('library_catalog.import.has_error')} /> : null}
          {plan.issues.some((i) => i.level === 'warning') ? <Chip size="small" color="warning" variant="outlined" label={t('library_catalog.import.has_warning')} /> : null}
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Issues issues={plan.issues} />
        {fields.length > 0 && plan.action !== 'error' ? (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('library_catalog.import.field_name')}</TableCell>
                  {create ? null : <TableCell>{t('library_catalog.import.current')}</TableCell>}
                  {create ? null : <TableCell padding="checkbox">{t('library_catalog.import.use_new')}</TableCell>}
                  <TableCell sx={{ minWidth: 200 }}>{t('library_catalog.import.new_value')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {fields.map((f) => {
                  const fieldState = state.fields[f.field] ?? { use: false, value: f.incoming ?? '' };
                  const label = t(`library_catalog.import.field.${f.field}`);
                  const set = (patch: Partial<{ use: boolean; value: string }>) =>
                    onChange({ ...state, fields: { ...state.fields, [f.field]: { ...fieldState, ...patch } } });
                  return (
                    <TableRow key={f.field}>
                      <TableCell>{label}</TableCell>
                      {create ? null : <TableCell sx={{ color: 'text.secondary', whiteSpace: 'pre-wrap' }}>{f.current ?? '—'}</TableCell>}
                      {create ? null : (
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={fieldState.use && !f.locked}
                            disabled={f.locked || !state.apply || blocked}
                            onChange={(e) => set({ use: e.target.checked })}
                            slotProps={{ input: { 'aria-label': t('library_catalog.import.use_new_for', { field: label }) } }}
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        <TextField
                          size="small"
                          fullWidth
                          value={fieldState.value}
                          disabled={f.locked || !state.apply || blocked || (!create && !fieldState.use)}
                          onChange={(e) => set({ value: e.target.value, use: true })}
                          multiline={f.field === 'description'}
                          slotProps={{ htmlInput: { 'aria-label': t('library_catalog.import.new_value_for', { field: label }) } }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        ) : plan.action === 'unchanged' ? (
          <Typography variant="body2" color="text.secondary">
            {t('library_catalog.import.nothing_to_change')}
          </Typography>
        ) : null}
        {children}
      </AccordionDetails>
    </Accordion>
  );
}

/** Preview first (writes nothing), choose what to apply per book/copy and per field, then import in one go. */
export function BooksImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<BooksImportReport | null>(null);
  const [states, setStates] = useState<States>({});
  const [committed, setCommitted] = useState<BooksImportReport['result'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setReport(null);
    setStates({});
    setCommitted(null);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const handleFile = async (selected: File | undefined) => {
    if (!selected) return;
    reset();
    setFile(selected);
    setBusy(true);
    try {
      const result = await gated('library_catalog.books.import', () => libraryCatalogApi.importBooksPreview(selected));
      setReport(result);
      setStates(buildStates(result));
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const selectedCount = useMemo(() => {
    if (!report) return 0;
    return report.books.reduce(
      (n, b) => n + (states[b.key]?.apply && (b.action === 'create' || b.action === 'update') ? 1 : 0) + b.copies.filter((c) => states[c.key]?.apply && (c.action === 'create' || c.action === 'update')).length,
      0,
    );
  }, [report, states]);

  const setAll = (apply: boolean) => {
    if (!report) return;
    setStates((prev) => {
      const next = { ...prev };
      for (const b of report.books) {
        next[b.key] = { ...next[b.key], apply: apply && (b.action === 'create' || b.action === 'update') };
        for (const c of b.copies) next[c.key] = { ...next[c.key], apply: apply && (c.action === 'create' || c.action === 'update') };
      }
      return next;
    });
  };

  const handleCommit = async () => {
    if (!file || !report) return;
    setBusy(true);
    setError(null);
    try {
      const result = await gated('library_catalog.books.import', () => libraryCatalogApi.importBooksCommit(file, toDecisions(report, states)));
      setCommitted(result.result ?? null);
      onImported();
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="lg" fullWidth>
      <DialogTitle>{t('library_catalog.import.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('library_catalog.import.help')}
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <input ref={inputRef} type="file" accept=".xlsx" hidden data-testid="books-import-input" aria-label={t('library_catalog.import.choose_file')} onChange={(e) => void handleFile(e.target.files?.[0])} />
          <Button variant="outlined" onClick={() => inputRef.current?.click()} disabled={busy} sx={{ alignSelf: 'flex-start' }}>
            {file ? file.name : t('library_catalog.import.choose_file')}
          </Button>
          {report && committed ? (
            <Alert severity="success">
              {t('library_catalog.import.committed', {
                booksCreated: committed.booksCreated,
                booksUpdated: committed.booksUpdated,
                copiesCreated: committed.copiesCreated,
                copiesUpdated: committed.copiesUpdated,
              })}
            </Alert>
          ) : null}
          {report && !committed ? (
            <>
              <Alert severity={report.errorCount ? 'warning' : report.warningCount ? 'info' : 'success'}>
                {t('library_catalog.import.summary', { books: report.books.length, errors: report.errorCount, warnings: report.warningCount })}
              </Alert>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Button size="small" onClick={() => setAll(true)}>
                  {t('library_catalog.import.select_all')}
                </Button>
                <Button size="small" onClick={() => setAll(false)}>
                  {t('library_catalog.import.select_none')}
                </Button>
                <Typography variant="body2" color="text.secondary">
                  {t('library_catalog.import.selected', { count: selectedCount })}
                </Typography>
              </Stack>
              <Paginated items={report.books} initialPageSize={10}>
                {(pageBooks) => (
                  <Box>
                    {pageBooks.map((book) => (
                      <ItemCard
                        key={book.key}
                        title={book.title ?? t('library_catalog.import.untitled')}
                        plan={book}
                        state={states[book.key]}
                        onChange={(next) => setStates((prev) => ({ ...prev, [book.key]: next }))}
                      >
                        {book.copies.length > 0 ? (
                          <Box sx={{ mt: 2, borderInlineStart: 3, borderColor: 'divider', paddingInlineStart: 2 }}>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>
                              {t('library_catalog.import.copies_of_book', { count: book.copies.length })}
                            </Typography>
                            {book.copies.map((copy) => (
                              <ItemCard
                                key={copy.key}
                                title={copy.code ?? t('library_catalog.import.auto_code')}
                                plan={copy}
                                state={states[copy.key]}
                                onChange={(next) => setStates((prev) => ({ ...prev, [copy.key]: next }))}
                              />
                            ))}
                          </Box>
                        ) : null}
                      </ItemCard>
                    ))}
                  </Box>
                )}
              </Paginated>
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t('core.common.close')}</Button>
        {report && !committed ? (
          <Button variant="contained" onClick={() => void handleCommit()} disabled={busy || selectedCount === 0}>
            {t('library_catalog.import.confirm', { count: selectedCount })}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
