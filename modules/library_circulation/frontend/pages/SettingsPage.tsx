import { Alert, Box, Button, Card, CardContent, Snackbar, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { useGatedCall } from '../../../../apps/web/src/shared/permissions';
import { libraryCirculationApi, type LoanPolicy } from '../api';

/**
 * The module's one `settings` manifest entry (`library_circulation.loan_policy`)
 * has no generic admin UI to edit it from — the platform's own per-module
 * Settings-screen surface (docs/MODULE_SPEC.md §8.3) is declared but not
 * actually built yet (root D70/D71, template module's settings.service.ts
 * docblock has the full story). This is this module's own minimal editor for
 * it, reading/writing the existing GET/PUT /settings/loan-policy endpoints
 * that were already there — only the UI to reach them was missing.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const gated = useGatedCall();
  const [policy, setPolicy] = useState<LoanPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  useEffect(() => {
    libraryCirculationApi
      .getLoanPolicy()
      .then(setPolicy)
      .catch((err) => setError(extractErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (field: keyof LoanPolicy, value: string) => {
    if (!policy) return;
    const numeric = Number(value);
    setPolicy({ ...policy, [field]: Number.isNaN(numeric) ? 0 : numeric });
  };

  const handleSave = async () => {
    if (!policy) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await gated('library_circulation.settings.update', () => libraryCirculationApi.updateLoanPolicy(policy));
      setPolicy(updated);
      setSnackbar(t('core.settings.saved'));
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 480 }}>
      <Typography variant="h4" component="h2" gutterBottom>
        {t('library_circulation.settings.loan_policy_label')}
      </Typography>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      {!loading && policy ? (
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                {t('library_circulation.settings.loan_policy_help')}
              </Typography>
              <TextField
                label={t('library_circulation.settings.max_books_per_student')}
                type="number"
                value={policy.maxBooksPerStudent}
                onChange={(e) => handleChange('maxBooksPerStudent', e.target.value)}
                slotProps={{ htmlInput: { min: 1 } }}
              />
              <TextField
                label={t('library_circulation.settings.loan_period_days')}
                type="number"
                value={policy.loanPeriodDays}
                onChange={(e) => handleChange('loanPeriodDays', e.target.value)}
                helperText={t('library_circulation.settings.loan_period_days_help')}
                slotProps={{ htmlInput: { min: 1 } }}
              />
              <TextField
                label={t('library_circulation.settings.fine_per_day')}
                type="number"
                value={policy.finePerDay}
                onChange={(e) => handleChange('finePerDay', e.target.value)}
                slotProps={{ htmlInput: { min: 0 } }}
              />
              <Box>
                <Button variant="contained" onClick={handleSave} disabled={saving}>
                  {t('core.common.save')}
                </Button>
              </Box>
            </Stack>
          </CardContent>
        </Card>
      ) : null}

      <Snackbar open={snackbar !== null} autoHideDuration={3000} onClose={() => setSnackbar(null)} message={snackbar} />
    </Box>
  );
}
