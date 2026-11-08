"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildXlsx = buildXlsx;
exports.readXlsx = readXlsx;
exports.readFirstSheet = readFirstSheet;
exports.cellToText = cellToText;
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
const utility_1 = require("write-excel-file/utility");
const node_1 = __importDefault(require("write-excel-file/node"));
const node_2 = __importDefault(require("read-excel-file/node"));
/** Excel refuses a cell with more than 32,767 characters. */
const MAX_CELL_CHARS = 32767;
// `Feature<any>`: this feature only edits sheet XML and never touches the file content type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dataValidationFeature = {
    files: {
        transform: {
            'xl/worksheets/sheet{id}.xml': {
                // `<dataValidations/>` has a fixed place among the sheet's other elements; the library knows it.
                transform: (xml, sheetOptions) => {
                    const rules = sheetOptions.dataValidation;
                    if (!rules || rules.length === 0)
                        return xml;
                    const order = (0, utility_1.getOrderOfSiblings)('xl/worksheets/sheet{id}.xml', 'worksheet');
                    if (!order)
                        throw new Error('write-excel-file did not return an order of siblings for `worksheet`');
                    return (0, utility_1.insertElementMarkupAccordingToOrderOfSiblings)(xml, dataValidationsXml(rules), order, 'worksheet');
                },
            },
        },
    },
};
function dataValidationsXml(rules) {
    const items = rules.map((rule) => {
        if (rule.fromRow < 1 || rule.column < 1 || rule.toRow < rule.fromRow)
            throw new Error('Invalid dropdown range');
        // A fixed list is written inline: "a,b,c" (Excel limits it to 255 characters in total, and a comma cannot be a choice).
        const formula = rule.values
            ? `"${rule.values.map((value) => value.replace(/[",]/g, ' ')).join(',')}"`
            : (rule.range ?? '');
        if (!formula || formula.length > 255)
            throw new Error('A dropdown needs 1-255 characters of choices or a range');
        const sqref = `${(0, utility_1.getCellAddress)(rule.fromRow - 1, rule.column - 1)}:${(0, utility_1.getCellAddress)(rule.toRow - 1, rule.column - 1)}`;
        return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" showInputMessage="1" sqref="${(0, utility_1.sanitizeAttributeValue)(sqref)}"><formula1>${(0, utility_1.sanitizeTextContent)(formula)}</formula1></dataValidation>`;
    });
    return `<dataValidations count="${items.length}">${items.join('')}</dataValidations>`;
}
function toCell(value) {
    if (value === null || value === undefined || value === '')
        return null;
    if (typeof value === 'string')
        return { value: value.length > MAX_CELL_CHARS ? value.slice(0, MAX_CELL_CHARS) : value };
    if (typeof value === 'number')
        return Number.isFinite(value) ? { value } : null;
    if (value instanceof Date)
        return Number.isNaN(value.getTime()) ? null : { value, format: 'yyyy-mm-dd hh:mm' };
    return { value };
}
/** Builds a workbook (one or more sheets) and returns the .xlsx file's bytes. */
async function buildXlsx(sheets) {
    const written = sheets.map((sheet) => {
        const data = [
            sheet.header.map((title) => ({ value: title, fontWeight: 'bold' })),
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
    const output = await (0, node_1.default)(written, { features: [dataValidationFeature] }).toBuffer();
    return Buffer.from(output);
}
/** Reads every sheet of an uploaded file. Throws when the file is not a readable .xlsx workbook. */
async function readXlsx(buffer) {
    const sheets = await (0, node_2.default)(buffer);
    return sheets.map((s) => ({ name: s.sheet, rows: s.data }));
}
/** Just the first sheet (what every import uses); undefined when the workbook has none. */
async function readFirstSheet(buffer) {
    return (await readXlsx(buffer))[0];
}
/**
 * One cell as trimmed text: numbers and booleans as written, dates as `YYYY-MM-DD`, anything else (or empty) as ''.
 * An invalid date is returned as the word `invalid`, which the date parsers then reject.
 */
function cellToText(value) {
    if (value === null || value === undefined)
        return '';
    if (value instanceof Date)
        return Number.isNaN(value.getTime()) ? 'invalid' : value.toISOString().slice(0, 10);
    if (typeof value === 'string')
        return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value).trim();
    return '';
}
