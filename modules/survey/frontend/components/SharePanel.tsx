import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** The one public address a reader opens (works for anonymous and logged-in readers alike). */
export function surveyShareUrl(surveyId: string, origin = window.location.origin): string {
  return `${origin}/survey/${surveyId}`;
}

/** Ready-to-paste iframe for a website page. The platform sets no frame-blocking headers, so this works as is. */
export function surveyEmbedSnippet(url: string, title: string): string {
  const safeTitle = title.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<iframe src="${url}" title="${safeTitle}" width="100%" height="700" style="border:0" loading="lazy"></iframe>`;
}

function downloadText(filename: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Everything an owner needs to put a survey in front of readers: the link, a
 * QR code for posters (drawn in the browser, no external service; downloadable
 * as PNG for printing or SVG for design tools) and an embed snippet. Nothing
 * is stored anywhere.
 */
export function SharePanel({ open, onClose, surveyId, title, published }: { open: boolean; onClose: () => void; surveyId: string; title: string; published: boolean }) {
  const { t } = useTranslation();
  const url = surveyShareUrl(surveyId);
  const embed = surveyEmbedSnippet(url, title);
  const [qrPng, setQrPng] = useState<string | null>(null);
  const [copied, setCopied] = useState<'link' | 'embed' | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    QRCode.toDataURL(url, { width: 512, margin: 2, errorCorrectionLevel: 'M' })
      .then((data) => !cancelled && setQrPng(data))
      .catch(() => !cancelled && setQrPng(null));
    return () => {
      cancelled = true;
    };
  }, [open, url]);

  const copy = async (what: 'link' | 'embed', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  const downloadSvg = async () => downloadText(`survey-${surveyId}.svg`, 'image/svg+xml', await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }));

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="share-dialog-title">
      <DialogTitle id="share-dialog-title">{t('survey.share.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {!published ? <Alert severity="warning">{t('survey.share.not_published')}</Alert> : null}

          <TextField
            label={t('survey.share.link')}
            value={url}
            fullWidth
            slotProps={{
              htmlInput: { readOnly: true, dir: 'ltr' },
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title={copied === 'link' ? t('survey.share.copied') : t('survey.share.copy')}>
                      <IconButton aria-label={t('survey.share.copy_link')} onClick={() => void copy('link', url)} edge="end">
                        <ContentCopyIcon />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              },
            }}
          />

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              {t('survey.share.qr_title')}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
              <Box sx={{ width: 180, height: 180, bgcolor: '#fff', border: 1, borderColor: 'divider', borderRadius: 1, p: 0.5, flexShrink: 0 }}>
                {qrPng ? <img src={qrPng} alt={t('survey.share.qr_alt', { title })} style={{ width: '100%', height: '100%' }} /> : null}
              </Box>
              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  {t('survey.share.qr_hint')}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<DownloadIcon />}
                    disabled={!qrPng}
                    component="a"
                    href={qrPng ?? undefined}
                    download={`survey-${surveyId}.png`}
                  >
                    {t('survey.share.download_png')}
                  </Button>
                  <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => void downloadSvg()}>
                    {t('survey.share.download_svg')}
                  </Button>
                </Stack>
              </Stack>
            </Stack>
          </Box>

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              {t('survey.share.embed_title')}
            </Typography>
            <TextField
              value={embed}
              fullWidth
              multiline
              minRows={2}
              slotProps={{ htmlInput: { readOnly: true, dir: 'ltr', 'aria-label': t('survey.share.embed_title') } }}
              helperText={t('survey.share.embed_hint')}
            />
            <Button size="small" startIcon={<ContentCopyIcon />} sx={{ mt: 1 }} onClick={() => void copy('embed', embed)}>
              {copied === 'embed' ? t('survey.share.copied') : t('survey.share.copy_embed')}
            </Button>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('core.common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
