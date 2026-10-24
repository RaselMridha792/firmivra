import { describe, expect, it } from 'vitest';
import {
  ApplyProfileChangeRequest,
  createAdminFirmProfileClient,
  createRequest,
  readProfileChangeTicket,
} from '../../src/index.js';

// The text R60's API writes for a Company Profile Request Change (profile-changes.service.ts).
const description = [
  "Fake Owner (Owner) asks Firmivra to change the firm's Company Information on Company Profile.",
  '',
  'Legal Company Name',
  'Current: Fake Firm LLC',
  'Proposed: Fake Firm Holdings LLC',
  '',
  'EIN (Tax ID)',
  'Current: Ending in 6789',
  'Proposed: 98-7654321',
  '',
  'Reason:',
  'We merged with the holding company.',
  'The IRS letter is attached.',
  '',
  "Nothing on the firm's profile changes until Firmivra applies it.",
].join('\n');
const subject = 'Company Information change request: Legal Company Name, EIN (Tax ID)';
const firm = '0199c0e0-0a00-7000-8000-000000000001';
const ticket = '0199c0e0-0b00-7000-8000-000000000002';

describe('admin firm profile', () => {
  it("reads a Request Change ticket's fields, values and reason", () => {
    expect(readProfileChangeTicket(subject, description)).toEqual({
      kind: 'COMPANY',
      fields: ['legalName', 'ein'],
      current: { legalName: 'Fake Firm LLC', ein: 'Ending in 6789' },
      proposed: { legalName: 'Fake Firm Holdings LLC', ein: '98-7654321' },
      reason: 'We merged with the holding company.\nThe IRS letter is attached.',
    });
  });

  it('is null for any other ticket, and keeps no value whose lines are missing', () => {
    expect(readProfileChangeTicket('Login problem', description)).toBeNull();
    expect(
      readProfileChangeTicket('Professional Licensing change request: License Number', 'Hi'),
    ).toEqual({
      kind: 'LICENSING',
      fields: ['licenseNumber'],
      current: {},
      proposed: {},
      reason: null,
    });
  });

  it('applies at least one value; the EIN as 9 digits', () => {
    expect(ApplyProfileChangeRequest.safeParse({}).success).toBe(false);
    expect(ApplyProfileChangeRequest.parse({ ein: '98-7654321' })).toEqual({ ein: '987654321' });
    expect(ApplyProfileChangeRequest.safeParse({ ein: '98-765' }).success).toBe(false);
    expect(ApplyProfileChangeRequest.safeParse({ licenseNumber: 'X1' }).success).toBe(false);
  });

  it('calls the firm’s profile-changes routes', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = url.endsWith('/apply')
        ? {
            ticketId: ticket,
            fields: ['legalName'],
            legalName: 'Fake Firm Holdings LLC',
            einLast4: null,
            appliedAt: '2026-10-24T12:00:00.000Z',
          }
        : {
            firm: { id: firm, name: 'Fake Firm', legalName: null, status: 'ACTIVE' },
            requests: [],
          };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof globalThis.fetch;
    const client = createAdminFirmProfileClient(createRequest({ baseUrl: '/api/v1', fetch }));
    await client.list(firm);
    await client.apply(firm, ticket, { legalName: 'Fake Firm Holdings LLC' });
    expect(calls.map((c) => [c.url, c.init.method ?? 'GET'])).toEqual([
      [`/api/v1/admin/firms/${firm}/profile-changes`, 'GET'],
      [`/api/v1/admin/firms/${firm}/profile-changes/${ticket}/apply`, 'POST'],
    ]);
  });
});
