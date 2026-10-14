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

/** What the readers export needs from the extension: who is in the club now, and what can be typed in the club columns. */
export interface ReaderExportClubData {
  /** studentId -> current group/stage names (members of the current episode only). */
  members: Record<string, { group: string | null; stage: string | null }>;
  /** The groups (and their stage names) a file may use right now — the export's reference sheet and dropdowns. */
  groups: Array<{ name: string; stages: Array<{ order: number; name: string }> }>;
}

export interface ReaderImportExtension {
  /** Current club membership + the valid group/stage names, for the export. */
  exportData(studentIds: string[]): Promise<ReaderExportClubData>;
  /** Read-only: one entry per row that cannot be applied. */
  validate(rows: ReaderImportClubRow[]): Promise<Array<{ row: number; error: string }>>;
  /** Applies already-validated rows, after the reader rows themselves were committed. */
  apply(entries: Array<ReaderImportClubRow & { studentId: string }>, actorId: string): Promise<void>;
}
