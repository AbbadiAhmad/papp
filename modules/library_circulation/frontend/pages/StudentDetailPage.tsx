import { Box, Chip, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { libraryCirculationApi } from '../api';

/** §25/§10 — the student's "reading passport": current loans + open fines. Full history export is a documented follow-up (DECISIONS.md). */
export function StudentDetailPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { studentId } = useParams<{ studentId: string }>();
  const { status, data: student, errorMessage, reload } = useGuardedQuery('library_circulation.students.view', () =>
    libraryCirculationApi.getStudent(studentId!),
  );

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {student?.code ?? t('library_circulation.menu.students')}
      </Typography>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        {student ? (
          <>
            <Typography variant="body1" sx={{ mb: 2 }}>
              {t('library_circulation.students.class_name')}: {student.className ?? '—'}
            </Typography>

            <Typography variant="h6" sx={{ mt: 3, mb: 1 }}>
              {t('library_circulation.students.active_borrowings')}
            </Typography>
            <TableContainer component={Paper} sx={{ mb: 3 }}>
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

            <Typography variant="h6" sx={{ mb: 1 }}>
              {t('library_circulation.students.open_fines')}
            </Typography>
            <TableContainer component={Paper}>
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
          </>
        ) : null}
      </QueryStateGate>
    </Box>
  );
}
