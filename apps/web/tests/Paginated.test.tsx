import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Paginated } from '../src/shared/components/Paginated';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key) }),
}));

const items = Array.from({ length: 60 }, (_, i) => `row-${i + 1}`);
const renderList = (list: string[]) =>
  render(<Paginated items={list}>{(rows) => <ul>{rows.map((r) => <li key={r}>{r}</li>)}</ul>}</Paginated>);

describe('Paginated', () => {
  it('shows only the first 25 rows and pages forward', () => {
    renderList(items);
    expect(screen.getAllByRole('listitem')).toHaveLength(25);
    expect(screen.getByText('row-25')).toBeInTheDocument();
    expect(screen.queryByText('row-26')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByText('row-26')).toBeInTheDocument();
    expect(screen.queryByText('row-1')).toBeNull();
  });

  it('shows everything and no pager for a short list', () => {
    renderList(items.slice(0, 5));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /next page/i })).toBeNull();
  });

  it('clamps to the last page when the list shrinks (filtering)', () => {
    const { rerender } = renderList(items);
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByText('row-51')).toBeInTheDocument();
    rerender(<Paginated items={items.slice(0, 30)}>{(rows) => <ul>{rows.map((r) => <li key={r}>{r}</li>)}</ul>}</Paginated>);
    expect(screen.getByText('row-26')).toBeInTheDocument();
    expect(screen.getByText('row-30')).toBeInTheDocument();
  });
});
