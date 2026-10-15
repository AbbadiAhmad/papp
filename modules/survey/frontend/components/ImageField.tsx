import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import ImageIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_ALT_LENGTH, MAX_IMAGE_BYTES } from '../../backend/question-rules.ts';
import { extractErrorMessage } from '../../../../apps/web/src/shared/api/httpClient';
import { mediaUrl, surveyApi, type SurveyImage } from '../api';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

interface Props {
  surveyId: string;
  label: string;
  value: SurveyImage | null | undefined;
  onChange: (value: SurveyImage | null) => void;
}

/** Upload / replace / remove one picture and its (required) description. Used for the survey, a section and a question. */
export function ImageField({ surveyId, label, value, onChange }: Props) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!ACCEPTED.includes(file.type)) return setError(t('survey.image.bad_type'));
    if (file.size > MAX_IMAGE_BYTES) return setError(t('survey.image.too_large'));
    setBusy(true);
    try {
      const { mediaId } = await surveyApi.uploadImage(surveyId, file);
      onChange({ mediaId, alt: value?.alt ?? '' });
    } catch (err) {
      setError(extractErrorMessage(err) || t('survey.image.upload_failed'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <Box sx={{ mt: 1 }}>
      <input ref={input} type="file" accept={ACCEPTED.join(',')} hidden data-testid="image-input" aria-label={label} onChange={(e) => void pick(e.target.files?.[0])} />
      {value ? (
        <Stack spacing={1}>
          <Box component="img" src={mediaUrl(value.mediaId)} alt={value.alt} sx={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain', alignSelf: 'flex-start', borderRadius: 1 }} />
          <TextField
            size="small"
            required
            label={t('survey.image.alt')}
            value={value.alt}
            onChange={(e) => onChange({ ...value, alt: e.target.value })}
            error={!value.alt.trim()}
            slotProps={{ htmlInput: { maxLength: MAX_ALT_LENGTH } }}
          />
          <Stack direction="row" spacing={1}>
            <Button size="small" startIcon={<ImageIcon />} disabled={busy} onClick={() => input.current?.click()}>
              {t('survey.image.replace')}
            </Button>
            <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => onChange(null)}>
              {t('survey.image.remove')}
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Button size="small" startIcon={<ImageIcon />} disabled={busy} onClick={() => input.current?.click()}>
          {busy ? t('survey.image.uploading') : label}
        </Button>
      )}
      {error ? (
        <Alert severity="error" sx={{ mt: 1 }}>
          <Typography variant="body2">{error}</Typography>
        </Alert>
      ) : null}
    </Box>
  );
}
