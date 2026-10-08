import { describe, expect, it } from 'vitest';
import {
  fileNameFitsType,
  UPLOAD_LIMITS,
  uploadContentTypeFor,
  UploadContentType,
} from '../../src/index.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('UPLOAD_LIMITS', () => {
  it('takes PDF, JPG, PNG, Excel (.xlsx) and Word (.docx), up to 10 MB', () => {
    expect(UPLOAD_LIMITS.types).toEqual({
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      [XLSX]: ['.xlsx'],
      [DOCX]: ['.docx'],
    });
    expect(UPLOAD_LIMITS.maxBytes).toBe(10 * 1024 * 1024);
    expect(UPLOAD_LIMITS.typeNames).toBe('PDF, JPG, PNG, Excel (.xlsx) or Word (.docx)');
  });

  it.each([
    ['.xls', 'application/vnd.ms-excel'],
    ['.xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12'],
    ['.doc', 'application/msword'],
    ['.docm', 'application/vnd.ms-word.document.macroEnabled.12'],
    ['.csv', 'text/csv'],
  ])('never takes the %s type', (_, type) => {
    const result = UploadContentType.safeParse(type);
    expect(result.error?.issues[0]?.message).toBe(
      'Upload a PDF, JPG, PNG, Excel (.xlsx) or Word (.docx) file',
    );
  });
});

describe('uploadContentTypeFor', () => {
  it.each([
    ["the browser's type when it is one of ours", 'Scan.pdf', 'application/pdf', 'application/pdf'],
    ["the browser's Excel type", 'Budget.xlsx', XLSX, XLSX],
    ['Excel from the name when the browser gives no type', 'Budget.xlsx', '', XLSX],
    [
      'Word from the name for application/octet-stream',
      'Lease.docx',
      'application/octet-stream',
      DOCX,
    ],
    ['the type of an ending in capitals', 'BUDGET.XLSX', '', XLSX],
    ['the type of a name with spaces around it', ' Scan.pdf ', '', 'application/pdf'],
    ['JPEG for either ending', 'id.JPEG', '', 'image/jpeg'],
  ])('answers %s', (_, fileName, browserType, expected) => {
    expect(uploadContentTypeFor(fileName, browserType)).toBe(expected);
  });

  it.each([
    ['an old Excel name', 'Budget.xls', ''],
    ['a macro-enabled Excel name', 'Budget.xlsm', ''],
    ['an old Word name', 'Letter.doc', 'application/octet-stream'],
    ['a macro-enabled Word name', 'Letter.docm', ''],
    ['a CSV name', 'Transactions.csv', ''],
    ['only the ending', '.xlsx', ''],
    ['no ending', 'Budget', ''],
    ['a second ending', 'Budget.xlsx.exe', ''],
    [
      'a browser type that is not ours, whatever the name',
      'Budget.xlsx',
      'application/vnd.ms-excel',
    ],
    ['a macro-enabled type', 'Budget.xlsm', 'application/vnd.ms-excel.sheet.macroenabled.12'],
    ['a CSV type', 'Transactions.xlsx', 'text/csv'],
    ['a ZIP type', 'Budget.xlsx', 'application/zip'],
    ['a name of an object property', 'Budget.xlsx', 'constructor'],
  ])('refuses %s (null)', (_, fileName, browserType) => {
    expect(uploadContentTypeFor(fileName, browserType)).toBeNull();
  });

  it("keeps the browser's type when the name does not fit it, for the name check to refuse", () => {
    expect(uploadContentTypeFor('Budget.xlsm', XLSX)).toBe(XLSX);
    expect(fileNameFitsType('Budget.xlsm', XLSX)).toBe(false);
  });
});

describe('fileNameFitsType', () => {
  it.each([
    ['Budget.xlsx', XLSX],
    ['budget.XLSX', XLSX],
    [' Lease.docx ', DOCX],
    ['id.jpg', 'image/jpeg'],
    ['id.jpeg', 'image/jpeg'],
  ] as const)('%s fits %s', (fileName, type) => {
    expect(fileNameFitsType(fileName, type)).toBe(true);
  });

  it.each([
    ['Budget.xlsm', XLSX],
    ['Budget.xls', XLSX],
    ['Letter.docm', DOCX],
    ['Letter.doc', DOCX],
    ['Budget.xlsx', DOCX],
    ['.xlsx', XLSX],
    ['Scan.pdf.exe', 'application/pdf'],
  ] as const)('%s does not fit %s', (fileName, type) => {
    expect(fileNameFitsType(fileName, type)).toBe(false);
  });
});
