import { TablePagination } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/**
 * Client-side pagination for a list that is already fully loaded: wrap the
 * table in it and render only the `rows` slice it hands you; the pager is
 * rendered right below. Lists with a server-side paged endpoint (audit log,
 * circulation readers) keep their own pager. Lives here so every list in
 * every module paginates the same way (root D88). The current page is
 * clamped, so filtering a list down never leaves the user on an empty page.
 */
export function Paginated<T>({ items, children, initialPageSize = 25 }: { items: readonly T[]; children: (rows: T[]) => ReactNode; initialPageSize?: number }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const lastPage = Math.max(0, Math.ceil(items.length / pageSize) - 1);
  const current = Math.min(page, lastPage);
  const rows = items.slice(current * pageSize, current * pageSize + pageSize);

  return (
    <>
      {children(rows)}
      {items.length > PAGE_SIZE_OPTIONS[0] ? (
        <TablePagination
          component="div"
          count={items.length}
          page={current}
          onPageChange={(_event, newPage) => setPage(newPage)}
          rowsPerPage={pageSize}
          rowsPerPageOptions={PAGE_SIZE_OPTIONS}
          onRowsPerPageChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(0);
          }}
          labelRowsPerPage={t('core.common.rows_per_page')}
          labelDisplayedRows={({ from, to, count }) => t('core.common.displayed_rows', { from, to, count })}
        />
      ) : null}
    </>
  );
}
