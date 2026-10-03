import { Alert, Box, Button, Card, CardContent, Rating, Snackbar, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { QueryStateGate } from '../../../../apps/web/src/shared/components/QueryStateGate';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { formatDateOnly } from '../../../../apps/web/src/shared/format';
import { useGuardedQuery } from '../../../../apps/web/src/shared/hooks/useGuardedQuery';
import { useLanguage } from '../../../../apps/web/src/app/LanguageContext';
import { libraryCatalogApi } from '../api';

/**
 * "The librarian has to approve the comments to publish it" (LIBRARY_CATALOG-D21)
 * — every written review sits here, pending, until a holder of
 * `library_catalog.books.moderate_ratings` approves or rejects it. The star
 * rating itself is never gated here — it already counts toward each book's
 * average the moment it's submitted (see BooksService.rateBook's docblock);
 * this queue is about the WRITTEN comment text only.
 */
export function ModerateReviewsPage() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { status, data: pending, errorMessage, reload } = useGuardedQuery(() => libraryCatalogApi.listPendingReviews());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const handleApprove = async (ratingId: string) => {
    setBusyId(ratingId);
    try {
      await libraryCatalogApi.approveReview(ratingId);
      reload();
    } catch (err) {
      setSnackbar(extractErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (ratingId: string) => {
    setBusyId(ratingId);
    try {
      await libraryCatalogApi.rejectReview(ratingId);
      reload();
    } catch (err) {
      setSnackbar(extractErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Box>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('library_catalog.menu.moderate_reviews')}
      </Typography>

      <QueryStateGate status={status} errorMessage={errorMessage} onRetry={reload}>
        {(pending ?? []).length === 0 ? (
          <Alert severity="success">{t('library_catalog.moderate_reviews.empty')}</Alert>
        ) : (
          <Stack spacing={2}>
            {(pending ?? []).map((review) => (
              <Card key={review.id}>
                <CardContent>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
                    <Stack spacing={0.5}>
                      <RouterLink to={`/library/books/${review.bookId}`}>
                        <Typography variant="subtitle1">{review.bookTitle ?? review.bookId}</Typography>
                      </RouterLink>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                          {review.userName ?? t('library_catalog.ratings.anonymous_reader')}
                        </Typography>
                        <Rating value={review.rating} size="small" readOnly />
                        <Typography variant="caption" color="text.secondary">
                          {formatDateOnly(review.updatedAt, language)}
                        </Typography>
                      </Stack>
                      <Typography variant="body2">{review.review}</Typography>
                    </Stack>
                    <Stack direction="row" spacing={1}>
                      <Button
                        variant="contained"
                        size="small"
                        onClick={() => handleApprove(review.id)}
                        disabled={busyId === review.id}
                      >
                        {t('library_catalog.moderate_reviews.approve_button')}
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        size="small"
                        onClick={() => handleReject(review.id)}
                        disabled={busyId === review.id}
                      >
                        {t('library_catalog.moderate_reviews.reject_button')}
                      </Button>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </QueryStateGate>

      <Snackbar open={snackbar !== null} autoHideDuration={4000} onClose={() => setSnackbar(null)} message={snackbar} />
    </Box>
  );
}
