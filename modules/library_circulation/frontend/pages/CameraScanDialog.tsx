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
 * for near-focus; support is genuinely uneven across engines/devices, which
 * is fine — an unsupported *advanced* constraint set is spec-required to be
 * skipped, not to fail the whole call (verified against
 * `VideoConstraintsUtil.isMediaStreamConstraintsValid` below; `focusMode`/
 * `focusDistance` aren't in its banned-audio-key list, so this object
 * passes validation on every engine).
 *
 * LIBRARY_CIRCULATION-D36 — the REAL bug, two misdiagnoses in (D34, D35):
 * every attempt so far assumed `Html5Qrcode.start(cameraIdOrConfig, config,
 * …)`'s first argument accepts arbitrary `MediaTrackConstraints` the same
 * way a raw `getUserMedia({video: …})` call would. It does not. Read
 * `html5-qrcode`'s own source (`createVideoConstraints()`): `cameraIdOrConfig`
 * is ONLY ever a camera-selection hint — `{facingMode: '…'}` or
 * `{deviceId: '…'}`, and it throws `"'cameraIdOrConfig' object should have
 * exactly 1 key, if passed as an object, found 2 keys"` if given more than
 * one. This object (`facingMode` + `advanced`) was being passed AS
 * `cameraIdOrConfig` — a 2-key object — so `.start()` threw that exact
 * error on EVERY call, on every platform, since the very commit that added
 * it; the camera was broken from the first instant this constant started
 * being used, not something that only surfaced on iPhone/Windows. It just
 * happened to look environment-specific because this throw happens
 * SYNCHRONOUSLY inside `.start()`'s own `new Promise(...)` executor,
 * before `this.stateManagerProxy`'s already-started SCANNING transition
 * ever gets cancelled — corrupting the scanner's internal state so even a
 * same-session retry with valid args then failed differently ("Cannot
 * transition to a new state, already under transition"), which is what
 * actually chased this in circles across two prior "fixes": D34 (a real
 * but unrelated hardening) and D35 (a plausible-sounding but wrong theory,
 * still passing the SAME malformed 2-key object, just wrapped in a retry
 * that could never succeed either).
 *
 * The real fix needs no fallback/retry at all: pass ONLY `{facingMode:
 * 'environment'}` (1 key) as `cameraIdOrConfig`, and put this near-focus
 * constraint in the SECOND argument's dedicated `videoConstraints` field
 * instead — which the library docs its own self as "will override other
 * parameters like 'cameraIdOrConfig'" and is merged in as real
 * `getUserMedia` video constraints, no key-count restriction. See
 * `startWith()` below for the corrected call shape.
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

      // Third user-reported bug on this dialog: on both iPhone (Safari) and
      // Windows (desktop Chrome/Edge) the error Alert appeared IMMEDIATELY,
      // with no browser permission prompt at all and nothing in the console.
      // Root cause (confirmed by reading html5-qrcode's own source,
      // `src/camera/factories.ts`'s `CameraFactory.failIfNotSupported()`):
      // `.start()` throws a bare string, `"navigator.mediaDevices not
      // supported"`, SYNCHRONOUSLY-under-the-covers (an `async` function's
      // `throw` becomes a rejected promise) the instant `getUserMedia` isn't
      // exposed at all — which is exactly what happens in an insecure
      // context (any origin that's neither `https:` nor `localhost`).
      // `docker-compose.yml`'s `web` service serves plain HTTP, so opening
      // the app via a LAN IP (the normal way to reach it from a phone or a
      // second machine) hits this on every platform identically — no
      // permission dialog is ever reached, matching the report exactly. The
      // existing generic `.catch()` below also never logged the rejection
      // reason anywhere, which is why "no error on console" held even
      // though the library itself threw a precise one. Checked up front so
      // the message told to the user is accurate instead of the generic
      // "check permissions" one, which is actively misleading here — no
      // permission was ever asked.
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
      // (LIBRARY_CIRCULATION-D36) for why. Arbitrary constraints like the
      // near-focus request go in `videoConstraints` on the 2nd arg instead.
      const startWith = (videoConstraints?: MediaTrackConstraints) =>
        scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 250, ...(videoConstraints ? { videoConstraints } : {}) },
          (decodedText) => {
            if (stoppedRef.current) return;
            stoppedRef.current = true;
            onDecodedRef.current(decodedText);
          },
          () => undefined, // per-frame "no code found yet" — not an error, ignored
        );

      // Kept as a defensive fallback (not the primary fix — see
      // LIBRARY_CIRCULATION-D36): even a VALID `videoConstraints` object
      // could in principle still be rejected by a given device/engine, so a
      // failure here retries once with no extra constraints at all before
      // giving up, rather than assuming either outcome.
      startWith({ facingMode: 'environment', advanced: [NEAR_FOCUS_VIDEO_CONSTRAINTS] })
        .catch((err) => {
          console.error(
            '[CameraScanDialog] scanner.start() with the near-focus constraint failed, retrying without it',
            err,
          );
          return startWith();
        })
        .then(() => {
          startedRef.current = true;
          if (stopRequestedRef.current) {
            safeStop(scanner);
          }
        })
        .catch((err) => {
          console.error('[CameraScanDialog] scanner.start() failed even without the near-focus constraint', err);
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
