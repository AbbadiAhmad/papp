import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUnsavedChangesGuard } from '../../frontend/components/useUnsavedChangesGuard';

function Harness({ dirty }: { dirty: boolean }) {
  useUnsavedChangesGuard(dirty, 'Leave without saving?');
  return (
    <div>
      <a href="/survey/surveys">other page</a>
      <a href={window.location.pathname}>same page</a>
      <a href="https://example.org/x">external</a>
      <a href="/elsewhere" target="_blank">new tab</a>
    </div>
  );
}

afterEach(() => vi.restoreAllMocks());

const link = (container: HTMLElement, text: string) => Array.from(container.querySelectorAll('a')).find((a) => a.textContent === text)!;

describe('useUnsavedChangesGuard', () => {
  it('asks before an in-app link is followed and cancels the click when declined', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { container } = render(<Harness dirty />);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link(container, 'other page').dispatchEvent(event);
    expect(confirm).toHaveBeenCalledWith('Leave without saving?');
    expect(event.defaultPrevented).toBe(true);
  });

  it('lets the click through when the person confirms', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = render(<Harness dirty />);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link(container, 'other page').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('never asks when nothing is unsaved', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { container } = render(<Harness dirty={false} />);
    link(container, 'other page').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('ignores the same page, external links, new-tab links and modified clicks', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { container } = render(<Harness dirty />);
    for (const text of ['same page', 'external', 'new tab']) {
      link(container, text).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    }
    link(container, 'other page').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('warns before the tab is closed only while there are unsaved changes, and stops after', () => {
    const { rerender } = render(<Harness dirty />);
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    rerender(<Harness dirty={false} />);
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
  });

  it('removes its listeners when the page unmounts', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { container, unmount } = render(<Harness dirty />);
    const anchor = link(container, 'other page');
    unmount();
    document.body.appendChild(anchor);
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(anchor);
  });
});
