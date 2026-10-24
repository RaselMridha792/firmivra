import { describe, expect, it } from 'vitest';
import { guessMap, parseCsv } from './csv';

// SM7 (Staff Management review, Oct 23): the template's own headers map without choosing each one.
describe('guessMap', () => {
  it("maps the template's headers and the usual names", () => {
    const template =
      'firstName,lastName,email,phone,jobTitle,role,department,employmentType,office,hireDate,employeeId\n' +
      'Alex,Sample,alex.sample@example.com,(555) 010-2030,Tax Preparer,TAX_PREPARER,Tax Services,FULL_TIME,Main Office,2026-01-15,E-1001\n';
    const { headers } = parseCsv(template);
    expect(guessMap(headers)).toEqual(Object.fromEntries(headers.map((h) => [h, h])));
    expect(guessMap(['First Name', 'Work Email', 'Employee ID', 'Notes'])).toEqual({
      'First Name': 'firstName',
      'Work Email': 'email',
      'Employee ID': 'employeeId',
    });
  });
});
