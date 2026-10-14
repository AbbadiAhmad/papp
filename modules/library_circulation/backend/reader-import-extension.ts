/**
 * Optional extension point for the readers Excel import. Another installed
 * module (today: reading_club) provides an implementation under this token;
 * `StudentsExcelService` looks it up lazily and, when absent, simply has no
 * club behaviour — library_circulation never imports reading_club (the
 * dependency runs the other way). The token is a plain string so both modules
 * can reference it without sharing an import.
 */
export const READER_IMPORT_EXTENSION = 'papp.library_circulation.reader_import_extension';

/** The club-related cells of one import row (all null = the row has no club data). */
export interface ReaderImportClubRow {
  row: number;
  /** "Club" column: true = in the current club episode, false = remove from it, null = blank. */
  club: boolean | null;
  clubGroup: string | null;
  clubStage: string | null;
}

export interface ReaderImportExtension {
  /** Read-only: one entry per row that cannot be applied. */
  validate(rows: ReaderImportClubRow[]): Promise<Array<{ row: number; error: string }>>;
  /** Applies already-validated rows, after the reader rows themselves were committed. */
  apply(entries: Array<ReaderImportClubRow & { studentId: string }>, actorId: string): Promise<void>;
}
