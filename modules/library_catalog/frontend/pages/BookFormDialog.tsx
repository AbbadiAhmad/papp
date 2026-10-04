import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { libraryCatalogApi, type CreateBookInput, type LibraryBook, type UpdateBookInput } from '../api';

interface Props {
  open: boolean;
  book: LibraryBook | null;
  onClose: () => void;
  onSubmit: (dto: CreateBookInput | UpdateBookInput) => Promise<void>;
}

/** Mirrors apps/web/src/core/users/UserFormDialog.tsx's own mount/remount-by-key pattern. */
export function BookFormDialog({ open, book, onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const isEdit = book !== null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? t('library_catalog.books.edit_title') : t('library_catalog.books.create_title')}</DialogTitle>
      {open ? <BookFormFields key={book?.id ?? 'new'} book={book} onClose={onClose} onSubmit={onSubmit} /> : null}
    </Dialog>
  );
}

function BookFormFields({ book, onClose, onSubmit }: { book: LibraryBook | null; onClose: () => void; onSubmit: Props['onSubmit'] }) {
  const { t } = useTranslation();
  const isEdit = book !== null;
  const [title, setTitle] = useState(book?.title ?? '');
  const [author, setAuthor] = useState(book?.author ?? '');
  const [publisher, setPublisher] = useState(book?.publisher ?? '');
  const [category, setCategory] = useState(book?.category ?? '');
  const [readingLevel, setReadingLevel] = useState(book?.readingLevel ?? '');
  const [language, setLanguage] = useState(book?.language ?? '');
  const [description, setDescription] = useState(book?.description ?? '');
  /** Optional (LIBRARY_CATALOG-D24) — reading_club sums this across stage book entries to auto-compute a `pages`-type stage's progress; kept as free text so the field can be genuinely blank rather than coerced to 0. */
  const [pageCount, setPageCount] = useState(book?.pageCount != null ? String(book.pageCount) : '');
  // CreateBookDto.copy is mandatory (LIBRARY_CATALOG-D11) — every book is
  // created together with its first physical copy in one transaction.
  // Never shown/sent on edit: a book's copies are their own sub-resource,
  // added/removed via the Copies tab, not through the book PATCH.
  // qrCode itself is now OPTIONAL server-side (LIBRARY_CATALOG-D22) — left
  // blank, the backend auto-assigns the next Bxxxxxx code. Pre-filled below
  // with that SAME suggested code so the librarian sees/can edit it before
  // saving, rather than a blank field with no code visible until after.
  const [copyQrCode, setCopyQrCode] = useState('');
  const [copyCondition, setCopyCondition] = useState('');
  const [copyLocation, setCopyLocation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isEdit) return;
    libraryCatalogApi.peekNextCopyCode().then(setCopyQrCode).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only peek; `isEdit` is stable for this component's lifetime (see the key={book?.id ?? 'new'} remount in BookFormDialog above).
  }, []);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        title,
        author: author || undefined,
        publisher: publisher || undefined,
        category: category || undefined,
        readingLevel: readingLevel || undefined,
        language: language || undefined,
        description: description || undefined,
        pageCount: pageCount.trim() ? Number(pageCount) : undefined,
        ...(isEdit
          ? {}
          : {
              copy: {
                // Sent as undefined (never '') when cleared — the backend
                // treats a present-but-empty qrCode as a validation error
                // (@MinLength(1)), auto-generating only on a truly OMITTED
                // field (LIBRARY_CATALOG-D22).
                qrCode: copyQrCode.trim() || undefined,
                condition: copyCondition || undefined,
                location: copyLocation || undefined,
              },
            }),
      });
      onClose();
    } catch (submitError) {
      setError(extractErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            label={t('library_catalog.fields.title')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
          />
          <TextField label={t('library_catalog.fields.author')} value={author} onChange={(e) => setAuthor(e.target.value)} />
          <TextField
            label={t('library_catalog.fields.publisher')}
            value={publisher}
            onChange={(e) => setPublisher(e.target.value)}
          />
          <TextField
            label={t('library_catalog.fields.category')}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <TextField
            label={t('library_catalog.fields.reading_level')}
            value={readingLevel}
            onChange={(e) => setReadingLevel(e.target.value)}
          />
          <TextField
            label={t('library_catalog.fields.language')}
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          />
          <TextField
            label={t('library_catalog.fields.page_count')}
            type="number"
            value={pageCount}
            onChange={(e) => setPageCount(e.target.value)}
            helperText={t('library_catalog.fields.page_count_hint')}
            slotProps={{ htmlInput: { min: 1 } }}
          />
          <TextField
            label={t('library_catalog.fields.description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={2}
          />

          {isEdit ? null : (
            <Accordion defaultExpanded disableGutters>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle2">{t('library_catalog.book.copies_section')}</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  <Typography variant="body2" color="text.secondary">
                    {t('library_catalog.book.add_copies_label')}
                  </Typography>
                  <TextField
                    label={t('library_catalog.copies.qr_code')}
                    value={copyQrCode}
                    onChange={(e) => setCopyQrCode(e.target.value)}
                    helperText={t('library_catalog.copies.qr_code_suggested_hint')}
                  />
                  <TextField
                    label={t('library_catalog.copies.condition')}
                    value={copyCondition}
                    onChange={(e) => setCopyCondition(e.target.value)}
                  />
                  <TextField
                    label={t('library_catalog.copies.location')}
                    value={copyLocation}
                    onChange={(e) => setCopyLocation(e.target.value)}
                  />
                </Stack>
              </AccordionDetails>
            </Accordion>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {t('core.common.cancel')}
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting || !title.trim()}>
          {t('core.common.save')}
        </Button>
      </DialogActions>
    </>
  );
}
