import { Link } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../../../../apps/web/src/app/AuthContext';
import { readerLabel } from '../api';

interface Props {
  readerId: string | null | undefined;
  name?: string | null;
  code?: string | null;
  /** Open the reader page in a new tab — for screens holding unsaved working state (the Scan desk). */
  newTab?: boolean;
  /** Overrides the default "Name (CODE)" text. */
  children?: React.ReactNode;
}

/**
 * A reader's name linking to their page (`/library-circulation/readers/:id`).
 * Falls back to plain text when the caller can't open that page
 * (`students.view`), so nobody gets a link that only bounces to /forbidden.
 */
export function ReaderLink({ readerId, name, code, newTab, children }: Props) {
  const { hasPermission } = useAuth();
  const label = children ?? readerLabel(name, code);
  if (!readerId || !hasPermission('library_circulation.students.view')) return <>{label}</>;
  return (
    <Link
      component={RouterLink}
      to={`/library-circulation/readers/${readerId}`}
      {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      underline="hover"
    >
      {label}
    </Link>
  );
}
