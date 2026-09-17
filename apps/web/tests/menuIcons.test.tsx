import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { resolveMenuIcon } from '../src/shared/modules/menuIcons';

/**
 * The "brand new icon name never breaks a module" guarantee (root
 * DECISIONS.md D78): an unrecognized icon name — exactly what a NEW
 * module ships before anyone bothers to add it to `menuIcons.tsx`'s
 * lookup — must render SOMETHING (the generic fallback), never throw or
 * render nothing at all.
 */
describe('shared/modules/menuIcons: resolveMenuIcon fallback', () => {
  it('renders a real icon for a known name', () => {
    const { container } = render(<>{resolveMenuIcon('Public')}</>);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('falls back to a generic icon for an unrecognized name — never throws, never renders nothing', () => {
    const { container } = render(<>{resolveMenuIcon('SomeBrandNewIconNoOneAddedYet')}</>);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('falls back to a generic icon when no icon name is given at all', () => {
    const { container } = render(<>{resolveMenuIcon(undefined)}</>);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
