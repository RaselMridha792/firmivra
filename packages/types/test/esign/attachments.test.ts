// Firm Sign contract follow-up (R13): a signer removes the file from one of their ATTACHMENT
// fields (`api.signing(slug).removeAttachment`). Synthetic data only.
import { describe, expect, it } from 'vitest';
import { ApiRequestError, createRequest, createSigningClient } from '../../src/index.js';

const fieldId = '0199b6e0-0000-7000-8000-000000000001';
const field = {
  id: fieldId,
  type: 'ATTACHMENT',
  pageIndex: 0,
  x: 0.1,
  y: 0.2,
  w: 0.3,
  h: 0.05,
  required: true,
  label: 'Photo ID',
  options: [],
  groupKey: null,
  value: null,
  attachmentName: null,
};

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const signing = (fn: typeof fetch) =>
  createSigningClient(createRequest({ baseUrl: '/api/v1', fetch: fn }), 'LVP');

describe('api.signing(slug).removeAttachment', () => {
  it('sends DELETE on the field and answers it with no file', async () => {
    const { fn, calls } = fakeFetch(200, field);
    expect(await signing(fn).removeAttachment(fieldId)).toEqual(field);
    expect(calls).toEqual([
      {
        url: `/api/v1/portal/lvp/sign/attachments/${fieldId}`,
        method: 'DELETE',
        body: undefined,
      },
    ]);
  });

  it('refuses a bad field id before sending (400)', async () => {
    const { fn, calls } = fakeFetch(200, field);
    const error = await signing(fn)
      .removeAttachment('not-a-uuid')
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(ApiRequestError);
    expect([(error as ApiRequestError).status, (error as ApiRequestError).code]).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);
    expect(calls).toEqual([]);
  });

  it('passes on 404 NOT_FOUND for a field that is not theirs or has no file', async () => {
    const { fn } = fakeFetch(404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
    const error = await signing(fn)
      .removeAttachment(fieldId)
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect([(error as ApiRequestError).status, (error as ApiRequestError).code]).toEqual([
      404,
      'NOT_FOUND',
    ]);
  });
});
