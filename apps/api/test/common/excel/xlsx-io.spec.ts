import { unzipSync, strFromU8 } from 'fflate';
import { buildXlsx, cellToText, readFirstSheet, readXlsx } from '../../../src/common/excel/xlsx-io';

const xmlOf = (buffer: Buffer, path: string): string => strFromU8(unzipSync(new Uint8Array(buffer))[path]);

describe('xlsx-io (root D126)', () => {
  it('round-trips text, numbers, booleans and keeps cell positions (blank cells stay blank)', async () => {
    const file = await buildXlsx([{ name: 'Data', header: ['a', 'b', 'c'], rows: [['x', 12.5, true], [null, undefined, ''], ['007', 0, false]] }]);
    const sheet = await readFirstSheet(file);
    expect(sheet?.name).toBe('Data');
    expect(sheet?.rows).toEqual([['a', 'b', 'c'], ['x', 12.5, true], [null, null, null], ['007', 0, false]]);
  });

  it('writes several sheets in order', async () => {
    const file = await buildXlsx([
      { name: 'One', header: ['h'], rows: [['1']] },
      { name: 'Two', header: ['h'], rows: [['2']] },
    ]);
    expect((await readXlsx(file)).map((s) => s.name)).toEqual(['One', 'Two']);
  });

  it('bolds the header, sets widths and can freeze it', async () => {
    const file = await buildXlsx([{ name: 'S', header: ['a'], widths: [30], rows: [['x']], freezeHeader: true }]);
    expect(xmlOf(file, 'xl/styles.xml')).toContain('<b/>');
    expect(xmlOf(file, 'xl/worksheets/sheet1.xml')).toContain('state="frozen"');
    expect(xmlOf(file, 'xl/worksheets/sheet1.xml')).toMatch(/<col [^>]*width="30/);
  });

  it('keeps formula-looking text as literal text, never a formula', async () => {
    const file = await buildXlsx([{ name: 'S', header: ['a'], rows: [['=1+1'], ['@SUM(A1)'], ['+cmd|x'], ['-2+3']] }]);
    expect(xmlOf(file, 'xl/worksheets/sheet1.xml')).not.toContain('<f>');
    expect((await readFirstSheet(file))?.rows.slice(1)).toEqual([['=1+1'], ['@SUM(A1)'], ['+cmd|x'], ['-2+3']]);
  });

  it('survives XML-hostile text, non-Latin text and very long text', async () => {
    const hostile = 'a<b>&"\'\u0000\u0007 ok';
    const arabic = 'مرحباً بالعالم';
    const long = 'x'.repeat(40000);
    const file = await buildXlsx([{ name: 'S', header: ['a'], rows: [[hostile], [arabic], [long]] }]);
    const rows = (await readFirstSheet(file))!.rows;
    expect(String(rows[1][0])).toContain('a<b>&"\'');
    expect(String(rows[1][0])).not.toContain('\u0000');
    expect(rows[2][0]).toBe(arabic);
    expect(String(rows[3][0]).length).toBe(32767);
  });

  it('reads dates as Date objects and writes them as real dates', async () => {
    const file = await buildXlsx([{ name: 'S', header: ['d'], rows: [[new Date(Date.UTC(2020, 4, 17))], [new Date('nope')]] }]);
    const rows = (await readFirstSheet(file))!.rows;
    expect(rows[1][0]).toBeInstanceOf(Date);
    expect(cellToText(rows[1][0])).toBe('2020-05-17');
    expect(rows).toHaveLength(2); // an invalid date is an empty cell, and trailing empty rows are not returned
  });

  it('writes dropdowns: a fixed list and a range on another sheet, in valid XML', async () => {
    const file = await buildXlsx([
      {
        name: 'Readers',
        header: ['name', 'active', 'group'],
        rows: [['a', 'yes', 'G1']],
        listValidations: [
          { column: 2, fromRow: 2, toRow: 50, values: ['yes', 'no'] },
          { column: 3, fromRow: 2, toRow: 50, range: "'Club reference'!$B$2:$B$9" },
        ],
      },
      { name: 'Club reference', header: ['g', 'groups'], rows: [['G1', 'G1']] },
    ]);
    const xml = xmlOf(file, 'xl/worksheets/sheet1.xml');
    expect(xml).toContain('<dataValidations count="2">');
    expect(xml).toContain('sqref="B2:B50"><formula1>"yes,no"</formula1>');
    expect(xml).toContain("sqref=\"C2:C50\"><formula1>'Club reference'!$B$2:$B$9</formula1>");
    // The element must come after the sheet data, as the format requires.
    expect(xml.indexOf('</sheetData>')).toBeLessThan(xml.indexOf('<dataValidations'));
    expect(xmlOf(file, 'xl/worksheets/sheet2.xml')).not.toContain('dataValidations');
  });

  it('refuses a bad dropdown definition', async () => {
    await expect(buildXlsx([{ name: 'S', header: ['a'], rows: [], listValidations: [{ column: 1, fromRow: 5, toRow: 2, values: ['a'] }] }])).rejects.toThrow();
    await expect(buildXlsx([{ name: 'S', header: ['a'], rows: [], listValidations: [{ column: 1, fromRow: 2, toRow: 3 }] }])).rejects.toThrow();
  });

  it('rejects something that is not an .xlsx file', async () => {
    await expect(readXlsx(Buffer.from('this is not a workbook'))).rejects.toBeDefined();
    await expect(readXlsx(Buffer.alloc(0))).rejects.toBeDefined();
  });

  it('cellToText flattens values to trimmed text', () => {
    expect(cellToText('  hi ')).toBe('hi');
    expect(cellToText(5)).toBe('5');
    expect(cellToText(true)).toBe('true');
    expect(cellToText(null)).toBe('');
    expect(cellToText(undefined)).toBe('');
    expect(cellToText({ text: 'x' })).toBe('');
    expect(cellToText(new Date('nope'))).toBe('invalid');
  });
});
