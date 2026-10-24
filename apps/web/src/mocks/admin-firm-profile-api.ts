import {
  type AdminFirmProfileClient,
  ApiRequestError,
  APPLICABLE_PROFILE_FIELDS,
  type AppliedProfileChange,
  ApplyProfileChangeRequest,
  type FirmProfileChangeRequest,
  type FirmProfileChanges,
  parseInput,
} from '@firmivra/types';
import { mockDelay, mockedEmpty } from '../lib/mock';

const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);

/** Two requests per firm, as R60's Company Profile raises them; synthetic values only. */
function requestsFor(firmId: string): FirmProfileChangeRequest[] {
  const at = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const id = (n: number) => `${firmId.slice(0, 24)}${String(n).padStart(12, '0')}`;
  return [
    {
      ticketId: id(2),
      number: '#0412',
      kind: 'LICENSING',
      fields: ['licenseNumber', 'expirationDate'],
      status: 'OPEN',
      submittedAt: at(1),
      current: { licenseNumber: 'Not on file', expirationDate: 'Not on file' },
      proposed: { licenseNumber: 'CPA-000000', expirationDate: '2028-06-30' },
      reason: 'Our license was renewed.',
      applied: null,
    },
    {
      ticketId: id(1),
      number: '#0405',
      kind: 'COMPANY',
      fields: ['legalName', 'ein'],
      status: 'IN_PROGRESS',
      submittedAt: at(3),
      current: { legalName: 'Sample Firm LLC', ein: 'Ending in 6789' },
      proposed: { legalName: 'Sample Firm Holdings LLC', ein: 'Ending in 4321' },
      reason: 'We merged with the holding company. The IRS letter is attached.',
      applied: null,
    },
  ];
}

/** The contract over an in-memory store; it refuses what the API refuses. */
export function createAdminFirmProfileMock(): AdminFirmProfileClient {
  const empty = mockedEmpty('adminFirmProfile');
  const firms = new Map<string, FirmProfileChanges>();
  const firmOf = (firmId: string) => {
    let firm = firms.get(firmId);
    if (!firm) {
      firm = {
        firm: { id: firmId, name: 'Sample Firm', legalName: 'Sample Firm LLC', status: 'ACTIVE' },
        requests: empty ? [] : requestsFor(firmId),
      };
      firms.set(firmId, firm);
    }
    return firm;
  };
  return {
    list: async (firmId) => {
      await mockDelay();
      return structuredClone(firmOf(firmId));
    },
    apply: async (firmId, ticketId, body): Promise<AppliedProfileChange> => {
      await mockDelay();
      const input = parseInput(ApplyProfileChangeRequest, body);
      const firm = firmOf(firmId);
      const request = firm.requests.find((r) => r.ticketId === ticketId);
      if (!request) throw fail(404, 'NOT_FOUND', 'Not found');
      if (request.status === 'CLOSED') throw fail(409, 'TICKET_CLOSED', 'This request is closed');
      const fields = APPLICABLE_PROFILE_FIELDS.filter((f) => input[f] !== undefined);
      if (fields.some((f) => !request.fields.includes(f)))
        throw fail(400, 'NOT_REQUESTED', 'Apply only what the request asks for');
      const appliedAt = new Date().toISOString();
      if (input.legalName !== undefined) firm.firm.legalName = input.legalName.trim();
      request.applied = { at: appliedAt, by: 'You', fields };
      return {
        ticketId,
        fields,
        legalName: firm.firm.legalName,
        einLast4: input.ein?.slice(-4) ?? null,
        appliedAt,
      };
    },
  };
}
