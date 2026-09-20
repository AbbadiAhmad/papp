import {
  Avatar,
  Box,
  Card,
  CardContent,
  Chip,
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
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { formatDateOnly, formatDateTime } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { libraryCirculationApi, type LibraryBorrowing, type StudentActionHistoryEntry } from '../api';
import { QrCodeImage } from './QrCodeImage';

/** §25/§10/§3.2-3.3 (docs/LIBRARY_IMPROVEMENTS.md) — the reader's "reading passport": current loans, full reading history (never deleted), open+paid fines, and an audit trail of changes to their own account. */
export function StudentDetailPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { studentId } = useParams<{ studentId: string }>();
  const [selectedTab, setSelectedTab] = useState(0);
  const { status, data: student, errorMessage, reload } = useGuardedQuery(() =>
    libraryCirculationApi.getStudent(studentId!),
  );

  const [readingHistory, setReadingHistory] = useState<LibraryBorrowing[] | null>(null);
  const [actionHistory, setActionHistory] = useState<StudentActionHistoryEntry[] | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);

  useEffect(() => {
    if (!studentId) return;
    if (selectedTab === 1 && readingHistory === null) {
      libraryCirculationApi.getStudentReadingHistory(studentId).then(setReadingHistory).catch((e) => setTabError(extractErrorMessage(e)));
    }
    if (selectedTab === 3 && actionHistory === null) {
      libraryCirculationApi.getStudentActionHistory(studentId).then(setActionHistory).catch((e) => setTabError(extractErrorMessage(e)));
    }
  }, [selectedTab, studentId, readingHistory, actionHistory]);

  return (
    <Box>
      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        {student ? (
          <Stack spacing={2}>
            {/* Reader Header Card — §3.2: photo/avatar, name, code, class, current borrowing count, total fines, account status */}
            <Card>
              <CardContent>
                <Stack direction="row" spacing={3} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <QrCodeImage value={student.code} size={96} />
                  <Avatar sx={{ width: 56, height: 56 }}>{(student.name ?? student.code).charAt(0).toUpperCase()}</Avatar>
                  <Stack spacing={1} sx={{ flex: 1 }}>
                    <Typography variant="h5">{student.name ?? student.code}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('library_circulation.students.code')}: {student.code} · {t('library_circulation.students.class_name')}:{' '}
                      {student.className ?? '—'}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                      <Chip
                        size="small"
                        label={t('library_circulation.students.current_books_count', { count: student.activeBorrowingsCount })}
                        color="primary"
                      />
                      {student.unpaidFinesTotal > 0 ? (
                        <Chip
                          size="small"
                          color="warning"
                          label={t('library_circulation.students.unpaid_fines_total', { amount: student.unpaidFinesTotal })}
                        />
                      ) : null}
                      <Chip
                        size="small"
                        color={student.isActive ? 'success' : 'default'}
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
                  {student.activeBorrowings.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {t('core.common.no_data')}
                    </Typography>
                  ) : (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>{t('library_circulation.borrowings.borrowed_at')}</TableCell>
                            <TableCell>{t('library_circulation.borrowings.due_at')}</TableCell>
                            <TableCell>{t('library_circulation.borrowings.status')}</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {student.activeBorrowings.map((b) => (
                            <TableRow key={b.id}>
                              <TableCell>{formatDateOnly(b.borrowedAt, language)}</TableCell>
                              <TableCell>{formatDateOnly(b.dueAt, language)}</TableCell>
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
              )}

              {/* Tab 1: Reading History — §3.2, full history, never deleted */}
              {selectedTab === 1 && (
                <Box sx={{ p: 2 }}>
                  {readingHistory === null ? (
                    <Typography variant="body2" color="text.secondary">
                      {t('core.common.loading')}
                    </Typography>
                  ) : readingHistory.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {t('core.common.no_data')}
                    </Typography>
                  ) : (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>{t('library_circulation.borrowings.borrowed_at')}</TableCell>
                            <TableCell>{t('library_circulation.borrowings.due_at')}</TableCell>
                            <TableCell>{t('library_circulation.borrowings.returned_at')}</TableCell>
                            <TableCell>{t('library_circulation.borrowings.status')}</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {readingHistory.map((b) => (
                            <TableRow key={b.id}>
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
              )}

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
                            <TableCell>{t('library_circulation.students.action_type')}</TableCell>
                            <TableCell>{t('library_circulation.students.action_details')}</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {actionHistory.map((entry) => (
                            <TableRow key={entry.id}>
                              <TableCell>{formatDateTime(entry.occurredAt, language)}</TableCell>
                              <TableCell>{t(`library_circulation.students.action_${entry.action}`, entry.action)}</TableCell>
                              <TableCell>
                                {entry.newValue
                                  ? Object.entries(entry.newValue)
                                      .map(([field, value]) => `${field}: ${JSON.stringify(value)}`)
                                      .join(', ')
                                  : '—'}
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
    </Box>
  );
}
