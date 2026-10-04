import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { Html5Qrcode } from 'html5-qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const SCANNER_ELEMENT_ID = 'library-circulation-camera-scanner';

/**
 * User-reported: the camera opens but doesn't refocus for a small, close-up
 * QR code (book spine stickers are scanned from a few cm away). Default
 * `getUserMedia()` autofocus on many devices settles on a middle/far
 * distance and is slow to re-hunt for near objects. `focusMode`/
 * `focusDistance` are W3C Image Capture `MediaTrackConstraints` that ask
 * for near-focus; support is uneven across devices, which is fine by
 * design — an unsupported *advanced* constraint set is spec-required to be
 * skipped, never to fail the whole call.
 *
 * Must go in `Html5Qrcode.start()`'s SECOND argument, as `videoConstraints`
 * (see the `.start()` call below) — NOT in the first argument
 * (`cameraIdOrConfig`), which only ever accepts a single-key camera-selection hint
 * (`{facingMode: '…'}` or `{deviceId: '…'}`) and throws if given more keys.
 * Full story (a real bug that took two wrong diagnoses to find):
 * `modules/library_circulation/DECISIONS.md` LIBRARY_CIRCULATION-D35–D37.
 */
const NEAR_FOCUS_VIDEO_CONSTRAINTS = {
  focusMode: 'manual',
  focusDistance: 0.1,
} as unknown as MediaTrackConstraintSet;

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
 *
 * Second bug fix (also user-reported): `.stop()` throws SYNCHRONOUSLY —
 * `"Cannot stop, scanner is not running or paused."` — if called while the
 * scanner is still in its `NOT_STARTED`/`LOADING` state, i.e. before
 * `.start()`'s own promise has resolved. `.start()` is genuinely slow (it
 * waits on the real camera permission prompt + stream setup), so closing
 * the dialog quickly (including the dialog auto-closing itself right after
 * a successful decode) could call `stopScanner()` well before `.start()`
 * finished — and since this throw is synchronous, `scanner.stop().catch()`
 * can never catch it (there's no promise yet to attach a catch to). Fixed
 * by tracking readiness explicitly (`startedRef`) and never calling
 * `.stop()` until `.start()` has actually resolved; if a stop is requested
 * before that, it's deferred — `setScannerHost`'s own `.then()` checks
 * `stopRequestedRef` right after `.start()` resolves and stops immediately
 * if a close happened in the meantime. `.stop()` is also wrapped in its own
 * try/catch as a last-resort safety net, matching the constructor's.
 */
export function CameraScanDialog({ open, onClose, onDecoded }: { open: boolean; onClose: () => void; onDecoded: (text: string) => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const stoppedRef = useRef(false);
  // True only once scanner.start()'s own promise has resolved — `.stop()`
  // must never be called before this, see this file's own docblock.
  const startedRef = useRef(false);
  // Set when a stop is requested (dialog closed) while `.start()` is still
  // pending — checked right after `.start()` resolves so the stop isn't
  // silently dropped just because it arrived "too early".
  const stopRequestedRef = useRef(false);
  const onDecodedRef = useRef(onDecoded);
  onDecodedRef.current = onDecoded;

  const safeStop = useCallback((scanner: Html5Qrcode) => {
    try {
      scanner.stop().catch(() => undefined);
    } catch {
      // `.stop()` can also throw SYNCHRONOUSLY (not just reject) when the
      // scanner isn't in a running/paused state — see docblock. Swallowed:
      // the dialog is closing either way, there is nothing further to do.
    }
  }, []);

  const stopScanner = useCallback(() => {
    stoppedRef.current = true;
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    if (startedRef.current) {
      safeStop(scanner);
    } else {
      // `.start()` hasn't resolved yet — defer; setScannerHost's `.then()`
      // checks this flag the moment it resolves and stops immediately.
      stopRequestedRef.current = true;
    }
  }, [safeStop]);

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
      startedRef.current = false;
      stopRequestedRef.current = false;

      // `getUserMedia`/`navigator.mediaDevices` is genuinely absent (not
      // merely unauthorized) on any origin that's neither `https:` nor
      // `localhost` — a real W3C secure-context restriction, not specific
      // to this app. Dormant today: this dev setup is reached via
      // `localhost` (Docker port-forwarding), which the spec exempts, so
      // this branch doesn't fire here. It only matters if this app is ever
      // reached over plain HTTP via a non-`localhost` address (e.g. a LAN
      // IP) — worth keeping so that scenario gets an accurate message
      // instead of the generic "check permissions" one, which would be
      // actively misleading (no permission is ever asked in that case).
      // NOT the cause of any camera bug reported so far — see
      // LIBRARY_CIRCULATION-D35/D37 in this module's DECISIONS.md.
      if (!navigator.mediaDevices?.getUserMedia) {
        console.error(
          '[CameraScanDialog] navigator.mediaDevices.getUserMedia is unavailable — the page is not running in a secure context (https:, or localhost). Camera access is impossible here regardless of OS-level permission state.',
        );
        setError(t('library_circulation.scan.camera_insecure_context_error'));
        return;
      }

      let scanner: Html5Qrcode;
      try {
        scanner = new Html5Qrcode(node.id);
      } catch (err) {
        console.error('[CameraScanDialog] Html5Qrcode construction failed', err);
        setError(t('library_circulation.scan.camera_error'));
        return;
      }
      scannerRef.current = scanner;
      // `cameraIdOrConfig` (1st arg) MUST be a single-key camera-selection
      // hint — see this file's own `NEAR_FOCUS_VIDEO_CONSTRAINTS` docblock
      // (LIBRARY_CIRCULATION-D37) for why. Arbitrary constraints like the
      // near-focus request go in `videoConstraints` on the 2nd arg instead.
      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 250, videoConstraints: { facingMode: 'environment', advanced: [NEAR_FOCUS_VIDEO_CONSTRAINTS] } },
          (decodedText) => {
            if (stoppedRef.current) return;
            stoppedRef.current = true;
            onDecodedRef.current(decodedText);
          },
          () => undefined, // per-frame "no code found yet" — not an error, ignored
        )
        .then(() => {
          startedRef.current = true;
          if (stopRequestedRef.current) {
            safeStop(scanner);
          }
        })
        .catch((err) => {
          console.error('[CameraScanDialog] scanner.start() failed', err);
          setError(t('library_circulation.scan.camera_error'));
        });
    },
    [safeStop, stopScanner, t],
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
