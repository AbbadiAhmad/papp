import { useEffect } from 'react';

/**
 * Warns before leaving a page with unsaved edits. The app uses a plain
 * `BrowserRouter` (no data router), so React Router's `useBlocker` is not
 * available; instead this covers the ways a person actually loses work:
 *  - closing/reloading the tab (`beforeunload`),
 *  - clicking any in-app link or menu entry (a capture-phase click listener on
 *    `document` runs before React Router sees the click and cancels it unless
 *    the person confirms).
 * Programmatic `navigate()` calls (for example the builder's own Back button)
 * must ask themselves; browser Back/Forward cannot be intercepted this way.
 */
export function useUnsavedChangesGuard(dirty: boolean, confirmMessage: string): void {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.origin !== window.location.origin) return;
      if (anchor.pathname === window.location.pathname && anchor.search === window.location.search) return;
      if (!window.confirm(confirmMessage)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, confirmMessage]);
}
