import { Alert, Box, Button, Card, CardContent, Chip, Paper, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, Typography } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { Can } from '../../../../apps/web/src/shared/permissions';
import { libraryCirculationApi, type LibraryBorrowing } from '../api';
import { ExtendLoanDialog } from './ExtendLoanDialog';
import { QrCodeImage } from './QrCodeImage';

/** §25/§10 — the student's "reading passport": current loans + open fines. Full history export is a documented follow-up (DECISIONS.md). */
export function StudentDetailPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { studentId } = useParams<{ studentId: string }>();
  const [selectedTab, setSelectedTab] = useState(0);
  const { status, data: student, errorMessage, reload } = useGuardedQuery(() =>
    libraryCirculationApi.getStudent(studentId!),
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

  return (
    <Box>
      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        {student ? (
          <Stack spacing={2}>
            {/* Reader Header Card */}
            <Card>
              <CardContent>
                <Stack direction="row" spacing={3} sx={{ alignItems: 'center' }}>
                  <QrCodeImage value={student.code} size={96} />
                  <Stack spacing={1} sx={{ flex: 1 }}>
                    <Typography variant="h5">{student.code}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('library_circulation.students.class_name')}: {student.className ?? '—'}
                    </Typography>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            {/* Tabs Section */}
            <Paper>
              <Tabs value={selectedTab} onChange={(_, newValue) => setSelectedTab(newValue)}>
                <Tab label={t('library_circulation.students.active_borrowings')} />
                <Tab label={t('library_circulation.students.open_fines')} />
              </Tabs>

              {/* Tab Content */}
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
                            <TableCell>{t('library_circulation.borrowings.borrowed_at')}</TableCell>
                            <TableCell>{t('library_circulation.borrowings.due_at')}</TableCell>
                            <TableCell>{t('library_circulation.borrowings.status')}</TableCell>
                            <TableCell>{t('library_circulation.borrowings.actions')}</TableCell>
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

              {selectedTab === 1 && (
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
