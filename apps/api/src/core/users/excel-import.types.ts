/**
 * D30 columns: name, email, ID (national/employee -> `externalId`), role
 * (role code), department. D42: preview validates everything and writes
 * nothing; commit re-validates from scratch and commits all-or-nothing.
 */
export interface ParsedImportRow {
  /** 1-based spreadsheet row number (header is row 1, so data starts at 2) — used in error messages. */
  row: number;
  name: string | null;
  email: string | null;
  externalId: string | null;
  roleCode: string | null;
  department: string | null;
  /**
   * `YYYY-MM-DD`; null = blank cell; undefined = the file has no such column
   * (an update then leaves the stored value alone).
   */
  dateOfBirth?: string | null;
  /** Set when the cell held something that is not a valid past date. */
  dateOfBirthInvalid?: boolean;
}

export type ImportRowAction = 'create' | 'update';

export interface ImportRowResult extends ParsedImportRow {
  valid: boolean;
  error: string | null;
  /** null when invalid — the resolved upsert action once/if this row is committed. */
  action: ImportRowAction | null;
  /** The existing user this row would update, when action === 'update'. */
  matchedUserId: string | null;
}

export interface ImportReport {
  rows: ImportRowResult[];
  validCount: number;
  invalidCount: number;
  /** True only when every row is valid — the precondition for POST /users/import to commit anything (D42 all-or-nothing). */
  allValid: boolean;
}

export interface ExportRow {
  name: string;
  email: string;
  externalId: string | null;
  role: string;
  department: string | null;
  dateOfBirth: string | null;
}
