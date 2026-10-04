import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { Html5Qrcode } from 'html5-qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const SCANNER_ELEMENT_ID = 'library-circulation-camera-scanner';

/**
 * §6's first of three scan input methods ("1. كاميرا الجهاز"). Mounted only
 * while `open` — `Html5Qrcode.start()`/`.stop()` own the real
 * `getUserMedia()` camera stream lifecycle, torn down on unmount/close so
 * the camera light never stays on after the dialog closes.
 *
 * Bug fix (user-reported): `new Html5Qrcode(SCANNER_ELEMENT_ID)` looks up
 * `document.getElementById(SCANNER_ELEMENT_ID)` SYNCHRONOUSLY inside its own
 * constructor and throws a bare string (not even an `Error`) if the element
 * isn't in the DOM yet — `"HTML Element with id=... not found"`, matching
 * the exact uncaught error reported. The old code constructed it from a
 * plain `useEffect([open])`, which fires the instant `open` becomes `true`
 * — but MUI's `Dialog` mounts its `DialogContent` (and therefore this
 * target `<Box>`) through its own open transition, so the element can
 * genuinely not exist in the DOM yet at that exact synchronous instant,
 * especially the dialog's very first open. Since the throw happens in the
 * CONSTRUCTOR (before `.start()` is ever reached), the existing
 * `.catch()` on `.start()` could never catch it — it was a fully uncaught
 * exception inside a `useEffect`, which crashed the whole page (React
 * unmounts the tree on an uncaught render-phase-adjacent error with no
 * boundary above it — matching the reported "page goes empty").
 *
 * Fix: a callback ref (`setScannerHost`) instead of the effect depending
 * on `open` alone — React only invokes a ref callback once the DOM node is
 * ACTUALLY attached, which is the real, non-guessable signal this needs
 * (no arbitrary `setTimeout`/`requestAnimationFrame` delay). The
 * `Html5Qrcode` constructor call is also now wrapped in try/catch, so even
 * a genuine future failure degrades to the existing error `Alert` instead
 * of crashing the page again.
 */
export function CameraScanDialog({ open, onClose, onDecoded }: { open: boolean; onClose: () => void; onDecoded: (text: string) => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const stoppedRef = useRef(false);
  const onDecodedRef = useRef(onDecoded);
  onDecodedRef.current = onDecoded;

  const stopScanner = useCallback(() => {
    stoppedRef.current = true;
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      scanner.stop().catch(() => undefined);
    }
  }, []);

  // Ref callback: fires with the real <div> once it's attached (dialog
  // opening) and again with `null` once it's detached (dialog closing) —
  // the camera's real lifecycle is driven by THIS, not by `open` alone.
  const setScannerHost = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) {
        stopScanner();
        return;
      }
      setError(null);
      stoppedRef.current = false;
      let scanner: Html5Qrcode;
      try {
        scanner = new Html5Qrcode(node.id);
      } catch {
        setError(t('library_circulation.scan.camera_error'));
        return;
      }
      scannerRef.current = scanner;
      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 250 },
          (decodedText) => {
            if (stoppedRef.current) return;
            stoppedRef.current = true;
            onDecodedRef.current(decodedText);
          },
          () => undefined, // per-frame "no code found yet" — not an error, ignored
        )
        .catch(() => setError(t('library_circulation.scan.camera_error')));
    },
    [stopScanner, t],
  );

  // Belt-and-suspenders teardown on unmount (e.g. navigating away while
  // open) — the ref callback's own `null` call already covers a normal
  // dialog close, this just guarantees the camera light never stays on.
  useEffect(() => stopScanner, [stopScanner]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('library_circulation.scan.camera_title')}</DialogTitle>
      <DialogContent>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {open ? <Box id={SCANNER_ELEMENT_ID} ref={setScannerHost} sx={{ width: '100%' }} /> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('core.common.cancel')}</Button>
      </DialogActions>
    </Dialog>
  );
}
