import type { StaffImportField } from '@firmivra/types';

export interface CsvFile {
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * A small CSV reader (RFC 4180: commas, quoted fields, doubled quotes, CRLF or LF). The browser
 * reads the file and only rows are sent (contract). Empty lines are skipped.
 */
export function parseCsv(text: string): CsvFile {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  // A spreadsheet's byte-order mark is not part of the first header.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && body[i + 1] === '\n') i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }
  const filled = records.filter((r) => r.some((x) => x.trim() !== ''));
  const headers = (filled[0] ?? []).map((h) => h.trim());
  const rows = filled
    .slice(1)
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { headers, rows };
}

/** Each field as the template names it, and the other names a column often has. */
export const FIELDS: {
  field: StaffImportField;
  label: string;
  required?: boolean;
  names: string[];
}[] = [
  {
    field: 'firstName',
    label: 'First Name',
    required: true,
    names: ['first name', 'first', 'given name'],
  },
  {
    field: 'lastName',
    label: 'Last Name',
    required: true,
    names: ['last name', 'last', 'surname', 'family name'],
  },
  {
    field: 'email',
    label: 'Work Email',
    required: true,
    names: ['work email', 'email', 'e-mail', 'email address'],
  },
  { field: 'phone', label: 'Phone', names: ['phone', 'phone number', 'mobile'] },
  { field: 'jobTitle', label: 'Job Title', names: ['job title', 'title', 'position'] },
  { field: 'role', label: 'Role', required: true, names: ['role', 'access role'] },
  {
    field: 'department',
    label: 'Department',
    required: true,
    names: ['department', 'departments', 'dept'],
  },
  { field: 'employmentType', label: 'Employment Type', names: ['employment type', 'type'] },
  {
    field: 'office',
    label: 'Office / Location',
    names: ['office', 'location', 'work location', 'branch'],
  },
  { field: 'hireDate', label: 'Hire Date', names: ['hire date', 'start date'] },
  { field: 'employeeId', label: 'Employee ID', names: ['employee id', 'employee number', 'id'] },
];

/** Maps each column whose name matches a field; one column per field. */
export function guessMap(headers: string[]): Record<string, StaffImportField> {
  const map: Record<string, StaffImportField> = {};
  const used = new Set<StaffImportField>();
  for (const h of headers) {
    const name = h.toLowerCase().replace(/[_*]/g, ' ').replace(/\s+/g, ' ').trim();
    const hit = FIELDS.find((f) => !used.has(f.field) && f.names.includes(name));
    if (hit) {
      map[h] = hit.field;
      used.add(hit.field);
    }
  }
  return map;
}
