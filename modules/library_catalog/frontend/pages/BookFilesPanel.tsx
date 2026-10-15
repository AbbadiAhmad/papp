import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/UploadFile';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import axios from 'axios';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../../../apps/web/src/shared/components/ConfirmDialog';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { Can, useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { formatNumber } from '../../../../apps/web/src/shared/format';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { downloadBlob, libraryCatalogApi, type BookFilesInfo } from '../api';

// The server is the authority on type and size; these only avoid sending an obviously wrong file.
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const MAX_BOOK_BYTES = 30 * 1024 * 1024;
const COVER_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
const BOOK_ACCEPT = '.pdf,.epub,.azw3,.mobi,.md,.txt,application/pdf,application/epub+zip,text/markdown,text/plain';

type Kind = 'cover' | 'book';

interface Props {
  bookId: string;
  files: BookFilesInfo | undefined;
  onChanged: () => void;
}

/** Cover picture and book file of one book: upload / replace / remove (books.update) and download (books.download). */
export function BookFilesPanel({ bookId, files, onChanged }: Props) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const gated = useGatedCall();
  const coverInput = useRef<HTMLInputElement>(null);
  const bookInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Kind | null>(null);

  const megabytes = (bytes: number) => `${formatNumber(Math.round((bytes / (1024 * 1024)) * 10) / 10, language)} MB`;

  const pick = async (kind: Kind, file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > (kind === 'cover' ? MAX_COVER_BYTES : MAX_BOOK_BYTES)) {
      setError(t(kind === 'cover' ? 'library_catalog.files.cover_too_large' : 'library_catalog.files.book_too_large'));
      return;
    }
    setBusy(kind);
    try {
      await gated('library_catalog.books.update', () => libraryCatalogApi.uploadBookFile(bookId, kind, file));
      onChanged();
    } catch (err) {
      // A proxy in front of the API answers an oversize body itself with a bare 413 page.
      setError(
        axios.isAxiosError(err) && err.response?.status === 413
          ? t('library_catalog.files.proxy_too_large')
          : extractErrorMessage(err) || t('library_catalog.files.upload_failed'),
      );
    } finally {
      setBusy(null);
      for (const ref of [coverInput, bookInput]) if (ref.current) ref.current.value = '';
    }
  };

  const remove = async () => {
    const kind = confirmRemove;
    setConfirmRemove(null);
    if (!kind) return;
    try {
      await gated('library_catalog.books.update', () => libraryCatalogApi.deleteBookFile(bookId, kind));
      onChanged();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const download = async () => {
    setError(null);
    try {
      const { blob, filename } = await gated('library_catalog.books.download', () => libraryCatalogApi.downloadBookFile(bookId));
      downloadBlob(blob, filename);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const row = (kind: Kind, input: React.RefObject<HTMLInputElement | null>, accept: string) => {
    const info = files?.[kind] ?? null;
    return (
      <Box>
        <input
          ref={input}
          type="file"
          accept={accept}
          hidden
          data-testid={`${kind}-input`}
          aria-label={t(`library_catalog.files.${kind}`)}
          onChange={(e) => void pick(kind, e.target.files?.[0])}
        />
        <Typography variant="subtitle2">{t(`library_catalog.files.${kind}`)}</Typography>
        <Typography variant="body2" color="text.secondary">
          {info ? `${info.ext.toUpperCase()} · ${megabytes(info.sizeBytes)}` : t('library_catalog.files.none')}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
          {kind === 'book' && info ? (
            <Can permission="library_catalog.books.download">
              <Button size="small" startIcon={<DownloadIcon />} onClick={() => void download()}>
                {t('library_catalog.files.download')}
              </Button>
            </Can>
          ) : null}
          <Can permission="library_catalog.books.update">
            <Button size="small" startIcon={<UploadIcon />} disabled={busy !== null} onClick={() => input.current?.click()}>
              {busy === kind
                ? t('library_catalog.files.uploading')
                : t(`library_catalog.files.${info ? 'replace' : 'upload'}_${kind}`)}
            </Button>
            {info ? (
              <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => setConfirmRemove(kind)}>
                {t('library_catalog.files.remove')}
              </Button>
            ) : null}
          </Can>
        </Stack>
        <Can permission="library_catalog.books.update">
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {t(`library_catalog.files.${kind}_hint`)}
          </Typography>
        </Can>
      </Box>
    );
  };

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" component="h3" gutterBottom>
        {t('library_catalog.files.title')}
      </Typography>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={4}>
        {row('cover', coverInput, COVER_ACCEPT)}
        {row('book', bookInput, BOOK_ACCEPT)}
      </Stack>
      <ConfirmDialog
        open={confirmRemove !== null}
        title={t('library_catalog.files.remove')}
        description={t('library_catalog.files.confirm_remove')}
        confirmLabel={t('library_catalog.files.remove')}
        confirmColor="error"
        onConfirm={() => void remove()}
        onCancel={() => setConfirmRemove(null)}
      />
    </Paper>
  );
}
