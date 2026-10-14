"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.READER_IMPORT_EXTENSION = void 0;
/**
 * Optional extension point for the readers Excel import. Another installed
 * module (today: reading_club) provides an implementation under this token;
 * `StudentsExcelService` looks it up lazily and, when absent, simply has no
 * club behaviour — library_circulation never imports reading_club (the
 * dependency runs the other way). The token is a plain string so both modules
 * can reference it without sharing an import.
 */
exports.READER_IMPORT_EXTENSION = 'papp.library_circulation.reader_import_extension';
