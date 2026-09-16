import AddIcon from '@mui/icons-material/Add';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import { useParams } from 'react-router-dom';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { useGatedCall, Can } from '../../../../apps/web/src/shared/permissions';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { libraryCatalogApi, type CreateBookCopyInput } from '../api';

export function BookDetailPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const { t } = useTranslation();
  const { language } = useLanguage();
  const gated = useGatedCall();
  const { status, data: book, errorMessage, reload } = useGuardedQuery('library_catalog.books.view', () =>
    libraryCatalogApi.getBook(bookId as string),
  );

  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Box>
      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        {book ? (
          <Stack spacing={3}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
              <Box>
                <Typography variant="h5">{book.title}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {book.author ?? t('library_catalog.fields.no_author')} · {book.category ?? '—'}
                </Typography>
              </Box>
              <Can permission="library_catalog.books.create">
                <Button startIcon={<AddIcon />} variant="contained" onClick={() => setCopyDialogOpen(true)}>
                  {t('library_catalog.actions.add_copy')}
                </Button>
              </Can>
            </Stack>

            {error ? <Alert severity="error">{error}</Alert> : null}

            <Paper sx={{ p: 2 }}>
              <Stack spacing={1}>
                <Typography variant="subtitle2">{t('library_catalog.fields.description')}</Typography>
                <Typography variant="body2">{book.description ?? '—'}</Typography>
                <Stack direction="row" spacing={3} sx={{ mt: 1 }}>
                  <Typography variant="body2">
                    {t('library_catalog.fields.publisher')}: {book.publisher ?? '—'}
                  </Typography>
                  <Typography variant="body2">
                    {t('library_catalog.fields.reading_level')}: {book.readingLevel ?? '—'}
                  </Typography>
                  <Typography variant="body2">
                    {t('library_catalog.fields.language')}: {book.language ?? '—'}
                  </Typography>
                </Stack>
              </Stack>
            </Paper>

            <Typography variant="h6">{t('library_catalog.copies.title')}</Typography>
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('library_catalog.copies.qr_code')}</TableCell>
                    <TableCell>{t('library_catalog.copies.status')}</TableCell>
                    <TableCell>{t('library_catalog.copies.condition')}</TableCell>
                    <TableCell>{t('library_catalog.copies.location')}</TableCell>
                    <TableCell>{t('library_catalog.copies.acquisition_date')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(book.copies ?? []).map((copy) => (
                    <TableRow key={copy.id} hover>
                      <TableCell>{copy.qrCode}</TableCell>
                      <TableCell>
                        <Chip size="small" label={t(`library_catalog.copy_status.${copy.status}`)} />
                      </TableCell>
                      <TableCell>{copy.condition ?? '—'}</TableCell>
                      <TableCell>{copy.location ?? '—'}</TableCell>
                      <TableCell>
                        {copy.acquisitionDate ? formatDateOnly(copy.acquisitionDate, language) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>
        ) : null}
      </QueryStateGate>

      <AddCopyDialog
        open={copyDialogOpen}
        onClose={() => setCopyDialogOpen(false)}
        onSubmit={async (dto) => {
          try {
            await gated('library_catalog.books.create', () => libraryCatalogApi.createCopy(bookId as string, dto));
            setCopyDialogOpen(false);
            reload();
          } catch (submitError) {
            setError(extractErrorMessage(submitError));
          }
        }}
      />
    </Box>
  );
}

function AddCopyDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (dto: CreateBookCopyInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [qrCode, setQrCode] = useState('');
  const [location, setLocation] = useState('');
  const [condition, setCondition] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit({ qrCode, location: location || undefined, condition: condition || undefined });
      setQrCode('');
      setLocation('');
      setCondition('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('library_catalog.actions.add_copy')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label={t('library_catalog.copies.qr_code')}
            value={qrCode}
            onChange={(e) => setQrCode(e.target.value)}
            required
            autoFocus
          />
          <TextField
            label={t('library_catalog.copies.condition')}
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
          />
          <TextField
            label={t('library_catalog.copies.location')}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {t('core.common.cancel')}
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting || !qrCode.trim()}>
          {t('core.common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
