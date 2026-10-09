import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  createEsignClient,
  createRequest,
  EsignApprovalBody,
  EsignBulkSendBody,
  EsignPutRecipient,
  EsignReportQuery,
} from '../../src/index.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const id = '0199b6e0-0000-7000-8000-000000000001';
const other = '0199b6e0-0000-7000-8000-000000000002';
const request = (fn: typeof fetch) => createRequest({ baseUrl: '/api/v1', fetch: fn });

describe('api.esign extras (contract 3)', () => {
  it('calls every route', async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = createEsignClient(request(fn));
    for (const call of [
      () => api.submitForApproval(id, { confirm: true }),
      () => api.decideApproval(id, { decision: 'APPROVE' }),
      () => api.saveAsVersion(id, { templateId: other, note: 'New fee table' }),
      () => api.inPerson.start(id, { recipientId: other }),
      () => api.inPerson.state(),
      () => api.inPerson.exit({ password: 'secret-for-test' }),
      () => api.roles.list(),
      () => api.roles.set(other, { esignRole: 'MANAGER' }),
      () => api.templates.versions(id),
      () => api.templates.restoreVersion(id, 2),
      () => api.templates.duplicate(id, { name: 'Copy' }),
      () => api.templates.bulkSend(id, { clients: [{ clientId: other }], confirm: true }),
      () => api.bulk(other),
      () => api.report({ from: '2026-01-01', to: '2026-03-31', senderId: other }),
    ]) {
      await call().catch(() => undefined);
    }
    const r = `/api/v1/esign/requests/${id}`;
    const t = `/api/v1/esign/templates/${id}`;
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${r}/submit-for-approval`,
      `POST ${r}/approval`,
      `POST ${r}/save-as-version`,
      `POST ${r}/in-person`,
      'GET /api/v1/esign/in-person',
      'POST /api/v1/esign/in-person/exit',
      'GET /api/v1/esign/roles',
      `PUT /api/v1/esign/roles/${other}`,
      `GET ${t}/versions`,
      `POST ${t}/versions/2/restore`,
      `POST ${t}/duplicate`,
      `POST ${t}/bulk-send`,
      `GET /api/v1/esign/bulk/${other}`,
      `GET /api/v1/esign/reports?from=2026-01-01&to=2026-03-31&senderId=${other}`,
    ]);
    expect(calls[10]!.body).toEqual({ name: 'Copy', visibility: 'FIRM' });
    expect(calls[11]!.body).toEqual({ clients: [{ clientId: other }], roles: [], confirm: true });
  });

  it('refuses bad input before sending', async () => {
    const { fn, calls } = fakeFetch(200, {});
    const api = createEsignClient(request(fn));
    for (const p of [
      api.decideApproval(id, { decision: 'REJECT' }),
      api.roles.set('not-a-uuid', { esignRole: 'MANAGER' }),
      api.roles.set(other, { esignRole: 'OWNER' as 'MANAGER' }),
      api.templates.restoreVersion(id, 0),
      api.inPerson.exit({ password: '' }),
      api.bulk('x'),
      api.report({ from: '2026-03-01', to: '2026-01-01' }),
    ]) {
      const e = await p.then(
        () => undefined,
        (x: unknown) => x,
      );
      expect(e).toBeInstanceOf(ApiRequestError);
      expect((e as ApiRequestError).status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('checks approvals, bulk send, reports and in-person recipients', () => {
    expect(EsignApprovalBody.safeParse({ decision: 'REJECT', note: 'Fix the fee' }).success).toBe(
      true,
    );
    const clients = Array.from({ length: 201 }, (_, i) => ({
      clientId: `0199b6e0-0000-7000-8000-${String(i).padStart(12, '0')}`,
    }));
    expect(EsignBulkSendBody.safeParse({ clients, confirm: true }).success).toBe(false);
    expect(
      EsignBulkSendBody.safeParse({ clients: [{ clientId: id }, { clientId: id }], confirm: true })
        .success,
    ).toBe(false);
    expect(
      EsignBulkSendBody.safeParse({
        clients: [{ clientId: id }],
        roles: [{ key: 'client', who: { type: 'CLIENT_LOGIN', clientAccountId: id } }],
        confirm: true,
      }).success,
    ).toBe(false);
    expect(EsignReportQuery.safeParse({ from: '2025-01-01', to: '2026-06-01' }).success).toBe(
      false,
    );
    expect(EsignReportQuery.safeParse({ from: '2025-01-01', to: '2025-12-31' }).success).toBe(true);
    const who = { type: 'EXTERNAL', name: 'Pat Sample', email: 'pat@example.test' } as const;
    expect(
      EsignPutRecipient.safeParse({ role: 'CLIENT', routingOrder: 1, delivery: 'IN_PERSON', who })
        .success,
    ).toBe(true);
    expect(
      EsignPutRecipient.safeParse({
        kind: 'CC',
        role: 'CLIENT',
        routingOrder: 1,
        delivery: 'IN_PERSON',
        who,
      }).success,
    ).toBe(false);
  });
});
