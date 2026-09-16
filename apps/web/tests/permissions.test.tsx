import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Can,
  PermissionGateProvider,
  useGatedCall,
  usePermission,
  useResetPermissionGate,
} from '../src/shared/permissions';

/**
 * shared/permissions.tsx's own docblock: permission state is learned ONLY
 * from a real API call's outcome, never precomputed. These tests exercise
 * that contract directly — `usePermission`/`<Can>` render optimistically
 * until `useGatedCall`'s wrapped call reports a real 403, denial then
 * persists per-code until `reset()` (login/logout) clears it, and two codes
 * are tracked independently of each other.
 */

function forbiddenError() {
  // Duck-typed to satisfy `axios.isAxiosError` (checks `isAxiosError === true`
  // and an object shape), without making a real network call.
  return { isAxiosError: true, response: { status: 403 } };
}

function Harness() {
  const gated = useGatedCall();
  const reset = useResetPermissionGate();
  const fooAllowed = usePermission('foo.action');
  const barAllowed = usePermission('bar.action');

  const deny = (code: string) => async () => {
    try {
      await gated(code, () => Promise.reject(forbiddenError()));
    } catch {
      // The component's own error handling (snackbar, etc.) isn't this
      // hook's concern — swallow here, same as a real caller would do
      // after showing its own error UI.
    }
  };

  const allow = (code: string) => async () => {
    await gated(code, () => Promise.resolve('ok'));
  };

  return (
    <div>
      {fooAllowed ? <button>foo-control</button> : null}
      <Can permission="bar.action">{barAllowed ? <button>bar-control</button> : null}</Can>
      <button onClick={deny('foo.action')}>deny-foo</button>
      <button onClick={deny('bar.action')}>deny-bar</button>
      <button onClick={allow('foo.action')}>allow-foo</button>
      <button onClick={() => reset()}>reset</button>
    </div>
  );
}

function renderHarness() {
  return render(
    <PermissionGateProvider>
      <Harness />
    </PermissionGateProvider>,
  );
}

describe('usePermission / <Can> / useGatedCall', () => {
  it('renders a gated control optimistically before any outcome is reported', () => {
    renderHarness();
    expect(screen.getByText('foo-control')).toBeInTheDocument();
    expect(screen.getByText('bar-control')).toBeInTheDocument();
  });

  it('hides the control for a code once runGated reports a real 403 for it', async () => {
    renderHarness();
    fireEvent.click(screen.getByText('deny-foo'));

    await waitFor(() => expect(screen.queryByText('foo-control')).not.toBeInTheDocument());
    // The other code is untouched.
    expect(screen.getByText('bar-control')).toBeInTheDocument();
  });

  it('tracks two different codes independently', async () => {
    renderHarness();
    fireEvent.click(screen.getByText('deny-bar'));

    await waitFor(() => expect(screen.queryByText('bar-control')).not.toBeInTheDocument());
    // foo.action was never denied — still visible.
    expect(screen.getByText('foo-control')).toBeInTheDocument();
  });

  it('reset() clears every denied code (login/logout)', async () => {
    renderHarness();
    fireEvent.click(screen.getByText('deny-foo'));
    fireEvent.click(screen.getByText('deny-bar'));

    await waitFor(() => {
      expect(screen.queryByText('foo-control')).not.toBeInTheDocument();
      expect(screen.queryByText('bar-control')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('reset'));

    await waitFor(() => {
      expect(screen.getByText('foo-control')).toBeInTheDocument();
      expect(screen.getByText('bar-control')).toBeInTheDocument();
    });
  });

  it('a later successful call for the same code clears an earlier denial', async () => {
    renderHarness();
    fireEvent.click(screen.getByText('deny-foo'));
    await waitFor(() => expect(screen.queryByText('foo-control')).not.toBeInTheDocument());

    fireEvent.click(screen.getByText('allow-foo'));
    await waitFor(() => expect(screen.getByText('foo-control')).toBeInTheDocument());
  });

  it('usePermission()/<Can> throw outside a PermissionGateProvider', () => {
    // Guards against accidentally rendering a gated page/control outside the
    // app shell's provider tree; React logs the error to the console — that
    // is expected and not asserted on here.
    function Bare() {
      usePermission('x');
      return null;
    }
    const spy = () => render(<Bare />);
    expect(spy).toThrow(/PermissionGateProvider/);
  });
});
