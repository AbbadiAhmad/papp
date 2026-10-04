import { render, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../../apps/web/src/app/i18n';
import circulationEn from '../../locales/en.json';
import { CameraScanDialog } from '../../frontend/pages/CameraScanDialog';

/**
 * User-reported bug: opening the camera scanner crashed the whole page with
 * an uncaught "HTML Element with id=library-circulation-camera-scanner not
 * found" error. Root cause (see CameraScanDialog.tsx's own docblock):
 * `new Html5Qrcode(id)` looks up `document.getElementById(id)`
 * SYNCHRONOUSLY in its own constructor and throws a bare string if the
 * element isn't attached yet — the old code constructed it from a plain
 * `useEffect([open])`, racing MUI `Dialog`'s own mount timing. These tests
 * mock `html5-qrcode` (no real camera/getUserMedia in jsdom) and assert the
 * fix's actual contract: the constructor is only ever called with an id
 * that genuinely resolves via `document.getElementById` at call time, and a
 * construction failure degrades to the error `Alert` instead of throwing
 * out of the component.
 */

const { startMock, stopMock, html5QrcodeMock } = vi.hoisted(() => ({
  startMock: vi.fn(),
  stopMock: vi.fn(),
  html5QrcodeMock: vi.fn(),
}));
let lastConstructedId: string | null = null;
let constructorShouldThrow = false;

vi.mock('html5-qrcode', () => ({ Html5Qrcode: html5QrcodeMock }));

beforeAll(async () => {
  i18n.addResourceBundle('en', 'translation', circulationEn, true, true);
  await i18n.changeLanguage('en');
});

// Re-applied every test (not just once in the `vi.mock` factory) because
// this project's vitest.config.ts sets `restoreMocks: true`, which resets a
// `vi.fn()` back to having no implementation between tests — a factory-set
// `.mockImplementation()` would silently stop firing after the first test.
beforeEach(() => {
  lastConstructedId = null;
  constructorShouldThrow = false;
  startMock.mockResolvedValue(undefined);
  stopMock.mockResolvedValue(undefined);
  // A regular `function`, NOT an arrow function — `new html5QrcodeMock(id)`
  // needs its mock implementation to be constructible (have a
  // `[[Construct]]` slot), which an arrow function never has. With an
  // arrow-function implementation, vi.fn() still RECORDS the call (hence
  // `mock.calls` looking correct) but silently never actually invokes the
  // implementation body under `new` — it falls back to returning a bare
  // `{}`, which is exactly the trap this comment is warning off.
  html5QrcodeMock.mockImplementation(function (id: string) {
    lastConstructedId = id;
    // Mirrors the real library's own synchronous DOM check (the exact
    // behavior this fix exists to never crash on).
    if (!document.getElementById(id)) {
      throw `HTML Element with id=${id} not found`;
    }
    if (constructorShouldThrow) {
      throw 'forced failure';
    }
    return { start: startMock, stop: stopMock };
  });
});

describe('CameraScanDialog', () => {
  it('never throws out of the component, even if the scanner element were somehow missing when constructed', () => {
    // The mock's own DOM check guards this: if the fix regressed back to
    // constructing from a plain effect instead of a ref callback, this
    // render would throw synchronously and this `expect` would fail.
    expect(() => render(<CameraScanDialog open onClose={vi.fn()} onDecoded={vi.fn()} />)).not.toThrow();
  });

  it('only constructs Html5Qrcode once the target element is actually in the DOM', async () => {
    render(<CameraScanDialog open onClose={vi.fn()} onDecoded={vi.fn()} />);

    await waitFor(() => expect(lastConstructedId).toBe('library-circulation-camera-scanner'));
    // If the element hadn't existed at construction time, the mock's own
    // guard above would have thrown — reaching here proves it existed.
    expect(startMock).toHaveBeenCalled();
  });

  it('shows the error Alert (not a crash) when Html5Qrcode construction fails for a real reason', async () => {
    constructorShouldThrow = true;

    const { findByText } = render(<CameraScanDialog open onClose={vi.fn()} onDecoded={vi.fn()} />);

    expect(await findByText(circulationEn['library_circulation.scan.camera_error'])).toBeTruthy();
  });

  it('stops the scanner when the dialog closes (ref callback receives null)', async () => {
    const { rerender } = render(<CameraScanDialog open onClose={vi.fn()} onDecoded={vi.fn()} />);
    await waitFor(() => expect(lastConstructedId).toBe('library-circulation-camera-scanner'));

    rerender(<CameraScanDialog open={false} onClose={vi.fn()} onDecoded={vi.fn()} />);

    await waitFor(() => expect(stopMock).toHaveBeenCalled());
  });
});
