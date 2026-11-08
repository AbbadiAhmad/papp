import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import { Box, Dialog, IconButton, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../../apps/web/src/shared/format';
import { useLanguage } from '../../../apps/web/src/app/LanguageContext';

export interface LightboxImage {
  /** Full-size picture. */
  url: string;
  alt: string;
}

interface Props {
  images: LightboxImage[];
  /** Index of the picture to show; null = closed. */
  index: number | null;
  onClose: () => void;
}

/**
 * Full-screen viewer for a book's pictures (LIBRARY_CATALOG-D39): the original picture, scaled to fit the
 * screen, with previous / next buttons and the arrow keys. Only the picture on show is loaded at full size.
 * The arrows are mirrored in RTL so "next" always points the way the text reads.
 */
export function ImageLightbox({ images, index, onClose }: Props) {
  const { t } = useTranslation();
  const { language, direction } = useLanguage();
  const [current, setCurrent] = useState(index ?? 0);
  useEffect(() => {
    if (index !== null) setCurrent(index);
  }, [index]);

  const count = images.length;
  const go = (step: number) => setCurrent((value) => (value + step + count) % count);
  const rtl = direction === 'rtl';

  useEffect(() => {
    if (index === null || count < 2) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') go(rtl ? -1 : 1);
      if (event.key === 'ArrowLeft') go(rtl ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` only closes over `count`.
  }, [index, count, rtl]);

  const image = images[current];
  if (index === null || !image) return null;
  return (
    <Dialog open fullScreen onClose={onClose} slotProps={{ paper: { sx: { bgcolor: 'rgba(0,0,0,0.92)', color: '#fff' } } }}>
      <IconButton aria-label={t('library_catalog.gallery.close')} onClick={onClose} sx={{ position: 'absolute', top: 8, insetInlineEnd: 8, color: '#fff', zIndex: 1 }}>
        <CloseIcon />
      </IconButton>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', p: { xs: 1, sm: 6 } }} onClick={onClose}>
        <Box
          component="img"
          src={image.url}
          alt={image.alt}
          data-testid="lightbox-image"
          onClick={(event) => event.stopPropagation()}
          sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
      </Box>
      {count > 1 ? (
        <>
          <IconButton aria-label={t('library_catalog.gallery.previous')} onClick={() => go(-1)} sx={{ position: 'absolute', insetInlineStart: 8, top: '50%', color: '#fff', bgcolor: 'rgba(255,255,255,0.15)' }}>
            {rtl ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </IconButton>
          <IconButton aria-label={t('library_catalog.gallery.next')} onClick={() => go(1)} sx={{ position: 'absolute', insetInlineEnd: 8, top: '50%', color: '#fff', bgcolor: 'rgba(255,255,255,0.15)' }}>
            {rtl ? <ChevronLeftIcon /> : <ChevronRightIcon />}
          </IconButton>
          <Typography variant="body2" sx={{ position: 'absolute', bottom: 12, left: 0, right: 0, textAlign: 'center' }}>
            {formatNumber(current + 1, language)} / {formatNumber(count, language)}
          </Typography>
        </>
      ) : null}
    </Dialog>
  );
}
