/**
 * Reading and writing .xlsx files for every import/export in the platform (root D126, replaces `exceljs`).
 *
 * Built on `write-excel-file` + `read-excel-file` (both maintained, tiny dependency trees). Framework-free on
 * purpose: modules keep an IDENTICAL copy of this file (`modules/<key>/backend/xlsx-io.ts`) because a module's
 * unit tests must not load `apps/api/dist`; `apps/api/test/common/excel/xlsx-io-copies.spec.ts` fails if a
 * copy drifts from this one. Change THIS file, then copy it over the three module copies.
 *
 * Text is always written as a text cell, never as a formula, so a value such as `=1+1` or `@SUM(...)` coming from
 * user data is shown literally and never evaluated when the file is opened (spreadsheet formula injection).
 */
import { getCellAddress, getOrderOfSiblings, insertElementMarkupAccordingToOrderOfSiblings, sanitizeAttributeValue, sanitizeTextContent } from 'write-excel-file/utility';
import type { Feature } from 'write-excel-file/node';
import writeXlsxFile from 'write-excel-file/node';
import readAllSheets from 'read-excel-file/node';

/** A cell value as it is stored in the file. `undefined`/`null`/`''` leave the cell empty. */
export type XlsxValue = string | number | boolean | Date | null | undefined;

/** A dropdown list on a block of cells (1-based row/column numbers; row 1 is the header). */
export interface XlsxListValidation {
  column: number;
  fromRow: number;
  toRow: number;
  /** Fixed choices, shown as a list. */
  values?: string[];
  /** Or a range on a sheet of the same file, e.g. `'Club reference'!$E$2:$E$9`. */
  range?: string;
}

export interface XlsxSheet {
  name: string;
  /** Column titles, written bold in row 1. */
  header: string[];
  /** Column widths in characters, in column order. */
  widths?: number[];
  rows: XlsxValue[][];
  /** Keep the header visible while scrolling. */
  freezeHeader?: boolean;
  listValidations?: XlsxListValidation[];
}

/** Excel refuses a cell with more than 32,767 characters. */
const MAX_CELL_CHARS = 32767;

// `Feature<any>`: this feature only edits sheet XML and never touches the file content type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dataValidationFeature: Feature<any> = {
  files: {
    transform: {
      'xl/worksheets/sheet{id}.xml': {
        // `<dataValidations/>` has a fixed place among the sheet's other elements; the library knows it.
        transform: (xml: string, sheetOptions: unknown) => {
          const rules = (sheetOptions as { dataValidation?: XlsxListValidation[] }).dataValidation;
          if (!rules || rules.length === 0) return xml;
          const order = getOrderOfSiblings('xl/worksheets/sheet{id}.xml', 'worksheet');
          if (!order) throw new Error('write-excel-file did not return an order of siblings for `worksheet`');
          return insertElementMarkupAccordingToOrderOfSiblings(xml, dataValidationsXml(rules), order, 'worksheet');
        },
      },
    },
  },
};

function dataValidationsXml(rules: XlsxListValidation[]): string {
  const items = rules.map((rule) => {
    if (rule.fromRow < 1 || rule.column < 1 || rule.toRow < rule.fromRow) throw new Error('Invalid dropdown range');
    // A fixed list is written inline: "a,b,c" (Excel limits it to 255 characters in total, and a comma cannot be a choice).
    const formula = rule.values
      ? `"${rule.values.map((value) => value.replace(/[",]/g, ' ')).join(',')}"`
      : (rule.range ?? '');
    if (!formula || formula.length > 255) throw new Error('A dropdown needs 1-255 characters of choices or a range');
    const sqref = `${getCellAddress(rule.fromRow - 1, rule.column - 1)}:${getCellAddress(rule.toRow - 1, rule.column - 1)}`;
    return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" showInputMessage="1" sqref="${sanitizeAttributeValue(sqref)}"><formula1>${sanitizeTextContent(formula)}</formula1></dataValidation>`;
  });
  return `<dataValidations count="${items.length}">${items.join('')}</dataValidations>`;
}

function toCell(value: XlsxValue): { value: string | number | boolean | Date; format?: string } | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return { value: value.length > MAX_CELL_CHARS ? value.slice(0, MAX_CELL_CHARS) : value };
  if (typeof value === 'number') return Number.isFinite(value) ? { value } : null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : { value, format: 'yyyy-mm-dd hh:mm' };
  return { value };
}

/** Builds a workbook (one or more sheets) and returns the .xlsx file's bytes. */
export async function buildXlsx(sheets: XlsxSheet[]): Promise<Buffer> {
  const written = sheets.map((sheet) => {
    const data = [
      sheet.header.map((title) => ({ value: title, fontWeight: 'bold' as const })),
      ...sheet.rows.map((row) => row.map(toCell)),
    ];
    const hasRules = (sheet.listValidations ?? []).length > 0;
    return {
      sheet: sheet.name,
      data,
      ...(sheet.widths ? { columns: sheet.widths.map((width) => ({ width })) } : {}),
      ...(sheet.freezeHeader ? { stickyRowsCount: 1 } : {}),
      ...(hasRules ? { dataValidation: sheet.listValidations } : {}),
    };
  });
  const output = await writeXlsxFile(written as never, { features: [dataValidationFeature] } as never).toBuffer();
  return Buffer.from(output);
}

export interface XlsxReadSheet {
  name: string;
  /** `rows[0]` is sheet row 1, and `rows[i][j]` is row i+1, column j+1 — positions match what the user sees in Excel. */
  rows: unknown[][];
}

/** Reads every sheet of an uploaded file. Throws when the file is not a readable .xlsx workbook. */
export async function readXlsx(buffer: Buffer): Promise<XlsxReadSheet[]> {
  const sheets = await readAllSheets(buffer);
  return sheets.map((s: { sheet: string; data: unknown[][] }) => ({ name: s.sheet, rows: s.data }));
}

/** Just the first sheet (what every import uses); undefined when the workbook has none. */
export async function readFirstSheet(buffer: Buffer): Promise<XlsxReadSheet | undefined> {
  return (await readXlsx(buffer))[0];
}

/**
 * One cell as trimmed text: numbers and booleans as written, dates as `YYYY-MM-DD`, anything else (or empty) as ''.
 * An invalid date is returned as the word `invalid`, which the date parsers then reject.
 */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'invalid' : value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  return '';
}
