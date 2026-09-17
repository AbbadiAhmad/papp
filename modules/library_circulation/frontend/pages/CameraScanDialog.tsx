import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { Html5Qrcode } from 'html5-qrcode';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const SCANNER_ELEMENT_ID = 'library-circulation-camera-scanner';

/**
 * §6's first of three scan input methods ("1. كاميرا الجهاز"). Mounted only
 * while `open` — `Html5Qrcode.start()`/`.stop()` own the real
 * `getUserMedia()` camera stream lifecycle, torn down on unmount/close so
 * the camera light never stays on after the dialog closes.
 */
export function CameraScanDialog({ open, onClose, onDecoded }: { open: boolean; onClose: () => void; onDecoded: (text: string) => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
    scannerRef.current = scanner;
    let stopped = false;

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 250 },
        (decodedText) => {
          if (stopped) return;
          stopped = true;
          onDecoded(decodedText);
        },
        () => undefined, // per-frame "no code found yet" — not an error, ignored
      )
      .catch(() => setError(t('library_circulation.scan.camera_error')));

    return () => {
      stopped = true;
      scanner.stop().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDecoded is a fresh closure every render; re-subscribing on it would restart the camera stream needlessly.
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('library_circulation.scan.camera_title')}</DialogTitle>
      <DialogContent>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Box id={SCANNER_ELEMENT_ID} sx={{ width: '100%' }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('core.common.cancel')}</Button>
      </DialogActions>
    </Dialog>
  );
}
