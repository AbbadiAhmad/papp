import {
  alpha,
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  MenuItem,
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
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { formatDateOnly, formatDateTime } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { Can } from '../../../../apps/web/src/shared/permissions';
import { libraryCirculationApi, type BookInfo, type BorrowingStatus, type LibraryBorrowing, type StudentActionHistoryEntry } from '../api';
import { ExtendLoanDialog } from './ExtendLoanDialog';
import { StatusPill } from '../../../../apps/web/src/shared/ui/kit';
import { QrCodeImage } from './QrCodeImage';

const BORROWING_STATUSES: BorrowingStatus[] = ['active', 'returned', 'overdue', 'lost', 'cancelled'];

/** Mirrors StudentsService.STUDENT_FIELD_LABELS on the backend — keep in sync if a new LibraryStudent field is ever added to that map. */
const CHANGE_FIELD_LABEL_KEYS: Record<string, string> = {
  code: 'library_circulation.students.code',
  className: 'library_circulation.students.class_name',
  academicYearId: 'library_circulation.students.academic_year',
};

/** §25/§10/§3.2-3.3 (docs/LIBRARY_IMPROVEMENTS.md) — the reader's "reading passport": current loans, full reading history (never deleted), open+paid fines, and an audit trail of changes to their own account. */
export function ReaderDetailPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { readerId } = useParams<{ readerId: string }>();
  const [selectedTab, setSelectedTab] = useState(0);
  const { status, data: student, errorMessage, reload } = useGuardedQuery(() =>
    libraryCirculationApi.getStudent(readerId!),
  );
  const [extendDialogOpen, setExtendDialogOpen] = useState(false);
  const [borrowingToExtend, setBorrowingToExtend] = useState<LibraryBorrowing | null>(null);
  const [loanPeriodDays, setLoanPeriodDays] = useState(14);
  const [extendBusy, setExtendBusy] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);

  const openExtendDialog = async (borrowing: LibraryBorrowing) => {
    setExtendError(null);
    try {
      const policy = await libraryCirculationApi.getLoanPolicy();
      setLoanPeriodDays(policy.loanPeriodDays);
      setBorrowingToExtend(borrowing);
      setExtendDialogOpen(true);
    } catch (err) {
      setExtendError(extractErrorMessage(err));
    }
  };

  const confirmExtend = async (newDueDate: string) => {
    if (!borrowingToExtend) return;
    setExtendBusy(true);
    setExtendError(null);
    try {
      await libraryCirculationApi.extendLoan(borrowingToExtend.id, newDueDate);
      setBorrowingToExtend(null);
      reload();
    } catch (err) {
      setExtendError(extractErrorMessage(err));
    } finally {
      setExtendBusy(false);
    }
  };

  const [readingHistory, setReadingHistory] = useState<(LibraryBorrowing & BookInfo)[] | null>(null);
  const [actionHistory, setActionHistory] = useState<StudentActionHistoryEntry[] | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);

  useEffect(() => {
    if (!readerId) return;
    if (selectedTab === 1 && readingHistory === null) {
      libraryCirculationApi.getStudentReadingHistory(readerId).then(setReadingHistory).catch((e) => setTabError(extractErrorMessage(e)));
    }
    if (selectedTab === 3 && actionHistory === null) {
      libraryCirculationApi.getStudentActionHistory(readerId).then(setActionHistory).catch((e) => setTabError(extractErrorMessage(e)));
    }
  }, [selectedTab, readerId, readingHistory, actionHistory]);

  return (
    <Box>
      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        {student ? (
          <Stack spacing={2}>
            {/* Reader Header Card — §3.2: photo/avatar, name, code, class, current borrowing count, total fines, account status */}
            <Card>
              <CardContent sx={(theme) => ({ bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.1) })}>
                <Stack direction="row" spacing={3} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <QrCodeImage value={student.code} size={96} />
                  <Avatar sx={{ width: 56, height: 56, bgcolor: 'primary.main', color: 'primary.contrastText', fontWeight: 800 }}>{(student.name ?? student.code).charAt(0).toUpperCase()}</Avatar>
                  <Stack spacing={1} sx={{ flex: 1 }}>
                    <Typography variant="h5">{student.name ?? student.code}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('library_circulation.students.code')}: {student.code} · {t('library_circulation.students.class_name')}:{' '}
                      {student.className ?? '—'}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                      <StatusPill tone="info" label={t('library_circulation.students.current_books_count', { count: student.activeBorrowingsCount })} />
                      {student.unpaidFinesTotal > 0 ? (
                        <StatusPill tone="warning" label={t('library_circulation.students.unpaid_fines_total', { amount: student.unpaidFinesTotal })} />
                      ) : null}
                      <StatusPill
                        tone={student.isActive ? 'success' : 'neutral'}
                        label={t(student.isActive ? 'library_circulation.students.status_active' : 'library_circulation.students.status_inactive')}
                      />
                    </Stack>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            {/* Tabs Section */}
            <Paper>
              <Tabs value={selectedTab} onChange={(_, newValue) => setSelectedTab(newValue)}>
                <Tab label={t('library_circulation.students.active_borrowings')} />
                <Tab label={t('library_circulation.students.reading_history')} />
                <Tab label={t('library_circulation.students.open_fines')} />
                <Tab label={t('library_circulation.students.actions')} />
              </Tabs>

              {tabError ? (
                <Box sx={{ p: 2 }}>
                  <Typography variant="body2" color="error">
                    {tabError}
                  </Typography>
                </Box>
              ) : null}

              {/* Tab 0: Current Books */}
              {selectedTab === 0 && (
                <Box sx={{ p: 2 }}>
                  {extendError ? (
                    <Alert severity="error" sx={{ mb: 2 }}>
                      {extendError}
                    </Alert>
                  ) : null}
                  {student.activeBorrowings.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {t('core.common.no_data')}
                    </Typography>
                  ) : (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>{t('library_circulation.scan.book_label')}</TableCell>
                            <TableCell>{t('library_circulation.borrowings.borrowed_at')}</TableCell>
                            <TableCell>{t('library_circulation.borrowings.due_at')}</TableCell>
                            <TableCell>{t('library_circulation.borrowings.status')}</TableCell>
                            <TableCell>{t('library_circulation.borrowings.actions')}</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {student.activeBorrowings.map((b) => (
                            <TableRow key={b.id}>
                              <TableCell>{b.bookTitle ?? b.qrCode ?? '—'}</TableCell>
                              <TableCell>{formatDateOnly(b.borrowedAt, language)}</TableCell>
                              <TableCell>{formatDateOnly(b.dueAt, language)}</TableCell>
                              <TableCell>
                                <Chip size="small" label={t(`library_circulation.borrowing_status.${b.status}`)} />
                              </TableCell>
                              <TableCell>
                                <Can permission="library_circulation.extend">
                                  <Button size="small" onClick={() => openExtendDialog(b)} disabled={extendBusy}>
                                    {t('library_circulation.borrowings.extend')}
                                  </Button>
                                </Can>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </Box>
              )}

              {/* Tab 1: Reading History — §3.2, full history, never deleted */}
              {selectedTab === 1 && <ReadingHistoryTab readingHistory={readingHistory} />}

              {/* Tab 2: Fines */}
              {selectedTab === 2 && (
                <Box sx={{ p: 2 }}>
                  {student.openFines.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {t('core.common.no_data')}
                    </Typography>
                  ) : (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>{t('library_circulation.fines.amount')}</TableCell>
                            <TableCell>{t('library_circulation.fines.amount_paid')}</TableCell>
                            <TableCell>{t('library_circulation.fines.status')}</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {student.openFines.map((f) => (
                            <TableRow key={f.id}>
                              <TableCell>{f.amount}</TableCell>
                              <TableCell>{f.amountPaid}</TableCell>
                              <TableCell>
                                <Chip size="small" label={t(`library_circulation.fine_status.${f.status}`)} />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </Box>
              )}

              {/* Tab 3: Actions — §3.3, audit trail of changes to this reader's own account */}
              {selectedTab === 3 && (
                <Box sx={{ p: 2 }}>
                  {actionHistory === null ? (
                    <Typography variant="body2" color="text.secondary">
                      {t('core.common.loading')}
                    </Typography>
                  ) : actionHistory.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {t('core.common.no_data')}
                    </Typography>
                  ) : (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>{t('library_circulation.students.action_date')}</TableCell>
                            <TableCell>{t('library_circulation.students.action_by')}</TableCell>
                            <TableCell>{t('library_circulation.students.action_type')}</TableCell>
                            <TableCell>{t('library_circulation.students.action_details')}</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {actionHistory.map((entry) => (
                            <TableRow key={entry.id}>
                              <TableCell>{formatDateTime(entry.occurredAt, language)}</TableCell>
                              <TableCell>{entry.actorName ?? t('library_circulation.students.action_by_system')}</TableCell>
                              <TableCell>{t(`library_circulation.students.action_${entry.action}`, entry.action)}</TableCell>
                              <TableCell>
                                {entry.changes.length === 0
                                  ? '—'
                                  : entry.changes
                                      .map((c) => `${t(CHANGE_FIELD_LABEL_KEYS[c.field] ?? c.field)}: ${c.before ?? '—'} → ${c.after ?? '—'}`)
                                      .join(', ')}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </Box>
              )}
            </Paper>
          </Stack>
        ) : null}
      </QueryStateGate>

      <ExtendLoanDialog
        open={extendDialogOpen}
        borrowing={borrowingToExtend}
        loanPeriodDays={loanPeriodDays}
        onExtend={confirmExtend}
        onClose={() => {
          setExtendDialogOpen(false);
          setBorrowingToExtend(null);
        }}
        loading={extendBusy}
      />
    </Box>
  );
}

interface ReadingHistoryFilter {
  readingLevel: string;
  category: string;
  status: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_READING_FILTER: ReadingHistoryFilter = { readingLevel: '', category: '', status: '', dateFrom: '', dateTo: '' };

/**
 * Reading History tab: filters (level/category/status/date range) over the
 * already-fetched full history — no new backend filter endpoint, since the
 * page already loads the reader's entire history in one call and it's a
 * per-reader list, not something that needs server-side pagination. The
 * stats summary ("how many books at each level") counts only `returned`
 * borrowings — a book still checked out isn't "read" yet.
 */
function ReadingHistoryTab({ readingHistory }: { readingHistory: (LibraryBorrowing & BookInfo)[] | null }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [filter, setFilter] = useState<ReadingHistoryFilter>(EMPTY_READING_FILTER);

  const handleFieldChange = (field: keyof ReadingHistoryFilter, value: string) => {
    setFilter((prev) => ({ ...prev, [field]: value }));
  };
  const clearFilters = () => setFilter(EMPTY_READING_FILTER);

  const { levels, categories } = useMemo(() => {
    const levelSet = new Set<string>();
    const categorySet = new Set<string>();
    for (const b of readingHistory ?? []) {
      if (b.readingLevel) levelSet.add(b.readingLevel);
      if (b.category) categorySet.add(b.category);
    }
    return { levels: [...levelSet].sort(), categories: [...categorySet].sort() };
  }, [readingHistory]);

  const filtered = useMemo(() => {
    if (!readingHistory) return [];
    return readingHistory.filter((b) => {
      if (filter.readingLevel && b.readingLevel !== filter.readingLevel) return false;
      if (filter.category && b.category !== filter.category) return false;
      if (filter.status && b.status !== filter.status) return false;
      if (filter.dateFrom && new Date(b.borrowedAt) < new Date(filter.dateFrom)) return false;
      if (filter.dateTo) {
        const end = new Date(filter.dateTo);
        end.setHours(23, 59, 59, 999);
        if (new Date(b.borrowedAt) > end) return false;
      }
      return true;
    });
  }, [readingHistory, filter]);

  // "How many books read at level X" — completed reads only (§ per user's
  // own clarification: a still-active borrowing isn't "read" yet), counted
  // over the CURRENTLY FILTERED set so the summary stays consistent with
  // whatever the table below is showing.
  const levelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of filtered) {
      if (b.status !== 'returned') continue;
      const key = b.readingLevel ?? t('library_circulation.students.reading_level_unknown');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, t]);

  const completedCount = filtered.filter((b) => b.status === 'returned').length;

  if (readingHistory === null) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {t('core.common.loading')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Grid container spacing={2} sx={{ alignItems: 'center' }}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                select
                label={t('library_catalog.fields.reading_level')}
                value={filter.readingLevel}
                onChange={(e) => handleFieldChange('readingLevel', e.target.value)}
                fullWidth
              >
                <MenuItem value="">{t('library_circulation.students.filter_any_level')}</MenuItem>
                {levels.map((lvl) => (
                  <MenuItem key={lvl} value={lvl}>
                    {lvl}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                select
                label={t('library_catalog.fields.category')}
                value={filter.category}
                onChange={(e) => handleFieldChange('category', e.target.value)}
                fullWidth
              >
                <MenuItem value="">{t('library_circulation.students.filter_any_category')}</MenuItem>
                {categories.map((cat) => (
                  <MenuItem key={cat} value={cat}>
                    {cat}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField
                select
                label={t('library_circulation.borrowings.status')}
                value={filter.status}
                onChange={(e) => handleFieldChange('status', e.target.value)}
                fullWidth
              >
                <MenuItem value="">{t('library_circulation.fines.filter_any_status')}</MenuItem>
                {BORROWING_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {t(`library_circulation.borrowing_status.${s}`)}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 1.5 }}>
              <TextField
                label={t('library_circulation.finance.filter_date_from')}
                type="date"
                value={filter.dateFrom}
                onChange={(e) => handleFieldChange('dateFrom', e.target.value)}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 1.5 }}>
              <TextField
                label={t('library_circulation.finance.filter_date_to')}
                type="date"
                value={filter.dateTo}
                onChange={(e) => handleFieldChange('dateTo', e.target.value)}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
            <Grid size={12}>
              <Button onClick={clearFilters}>{t('library_circulation.finance.clear_filters')}</Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Stats: how many books read (completed/returned only) at each level, over the current filter. */}
      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
          {t('library_circulation.students.completed_reads_count', { count: completedCount })}
        </Typography>
        {levelCounts.map(([level, count]) => (
          <Chip key={level} size="small" variant="outlined" label={`${level}: ${count}`} />
        ))}
      </Stack>

      {filtered.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('core.common.no_data')}
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('library_circulation.scan.book_label')}</TableCell>
                <TableCell>{t('library_catalog.fields.category')}</TableCell>
                <TableCell>{t('library_catalog.fields.reading_level')}</TableCell>
                <TableCell>{t('library_circulation.borrowings.borrowed_at')}</TableCell>
                <TableCell>{t('library_circulation.borrowings.due_at')}</TableCell>
                <TableCell>{t('library_circulation.borrowings.returned_at')}</TableCell>
                <TableCell>{t('library_circulation.borrowings.status')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>{b.bookTitle ?? b.qrCode ?? '—'}</TableCell>
                  <TableCell>{b.category ?? '—'}</TableCell>
                  <TableCell>{b.readingLevel ?? '—'}</TableCell>
                  <TableCell>{formatDateOnly(b.borrowedAt, language)}</TableCell>
                  <TableCell>{formatDateOnly(b.dueAt, language)}</TableCell>
                  <TableCell>{b.returnedAt ? formatDateOnly(b.returnedAt, language) : '—'}</TableCell>
                  <TableCell>
                    <Chip size="small" label={t(`library_circulation.borrowing_status.${b.status}`)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
