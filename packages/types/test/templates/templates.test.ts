import { describe, expect, it } from 'vitest';
import {
  BulkTemplatesRequest,
  CreateMessageTemplateRequest,
  CreateTemplateCategoryRequest,
  ImportTemplateRequest,
  MessageTemplatesQuery,
  SaveCustomMergeFieldRequest,
  SaveTemplateBrandingRequest,
  StartTemplateAttachmentRequest,
  TestSendTemplateRequest,
  UpdateMessageTemplateRequest,
  createRequest,
  createTemplatesClient,
} from '../../src/index.js';

const id = '0199c0e0-0a00-7000-8000-000000000001';
const other = '0199c0e0-0a00-7000-8000-000000000002';
const sha = 'a'.repeat(64);

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('template requests', () => {
  const base = { kind: 'EMAIL', name: 'New Client Welcome', body: 'Hello [Client First Name]' };

  it('takes the form’s fields, strictly', () => {
    expect(CreateMessageTemplateRequest.safeParse(base).success).toBe(true);
    expect(
      CreateMessageTemplateRequest.safeParse({
        ...base,
        categoryId: id,
        description: 'Welcomes a new client',
        subject: 'Welcome to [Business Name]',
        previewText: 'We are glad you are here',
        status: 'ACTIVE',
        access: 'SELECTED',
        sharedWithUserIds: [other],
        tags: ['welcome', 'onboarding'],
        includeInAutomations: true,
      }).success,
    ).toBe(true);
    expect(CreateMessageTemplateRequest.safeParse({ ...base, businessId: id }).success).toBe(false);
    expect(CreateMessageTemplateRequest.safeParse({ ...base, kind: 'FAX' }).success).toBe(false);
    // A template is made as a draft or active, never archived.
    expect(CreateMessageTemplateRequest.safeParse({ ...base, status: 'ARCHIVED' }).success).toBe(
      false,
    );
  });

  it('keeps the text in the database’s limits, and tags short and unique', () => {
    const bad = (o: object) => CreateMessageTemplateRequest.safeParse({ ...base, ...o }).success;
    expect(bad({ name: '' })).toBe(false);
    expect(bad({ name: 'x'.repeat(201) })).toBe(false);
    expect(bad({ body: '   ' })).toBe(false);
    expect(bad({ body: 'x'.repeat(50_001) })).toBe(false);
    expect(bad({ subject: 'x'.repeat(301) })).toBe(false);
    expect(bad({ previewText: 'x'.repeat(201) })).toBe(false);
    expect(bad({ tags: ['a', 'A'] })).toBe(false);
    expect(bad({ tags: ['x'.repeat(41)] })).toBe(false);
    expect(bad({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).toBe(false);
    expect(bad({ subject: null, description: null })).toBe(true);
  });

  it('a change names the version it started from and at least one field', () => {
    expect(UpdateMessageTemplateRequest.safeParse({ priority: 1 }).success).toBe(false);
    expect(UpdateMessageTemplateRequest.safeParse({ etag: 'v1' }).success).toBe(false);
    expect(
      UpdateMessageTemplateRequest.safeParse({ etag: 'v1', confirmAutomationImpact: true }).success,
    ).toBe(false);
    expect(UpdateMessageTemplateRequest.safeParse({ etag: 'v1', subject: null }).success).toBe(
      true,
    );
    // The kind never changes.
    expect(UpdateMessageTemplateRequest.safeParse({ etag: 'v1', kind: 'SMS' }).success).toBe(false);
  });

  it('bulk actions carry their own fields and ask to confirm an archive', () => {
    const ids = [id, other];
    expect(BulkTemplatesRequest.safeParse({ action: 'ARCHIVE', ids }).success).toBe(false);
    expect(BulkTemplatesRequest.safeParse({ action: 'ARCHIVE', ids, confirm: true }).success).toBe(
      true,
    );
    expect(
      BulkTemplatesRequest.safeParse({ action: 'SET_CATEGORY', ids, categoryId: null }).success,
    ).toBe(true);
    expect(BulkTemplatesRequest.safeParse({ action: 'ADD_TAG', ids, tag: 'tax' }).success).toBe(
      true,
    );
    expect(BulkTemplatesRequest.safeParse({ action: 'ADD_TAG', ids }).success).toBe(false);
    expect(BulkTemplatesRequest.safeParse({ action: 'ADD_TAG', ids: [], tag: 'x' }).success).toBe(
      false,
    );
  });
});

describe('queries', () => {
  it('defaults the library and reads a true/false filter', () => {
    expect(MessageTemplatesQuery.parse({})).toMatchObject({
      tab: 'all',
      sort: 'updated',
      direction: 'desc',
      page: 1,
      pageSize: 10,
    });
    expect(MessageTemplatesQuery.parse({ tab: 'favorites', automations: 'true' })).toMatchObject({
      tab: 'favorites',
      automations: true,
    });
    expect(MessageTemplatesQuery.safeParse({ tab: 'everyone' }).success).toBe(false);
    expect(MessageTemplatesQuery.safeParse({ pageSize: '101' }).success).toBe(false);
  });
});

describe('categories, merge fields, branding, import', () => {
  it('a category has a kind and a short name', () => {
    expect(
      CreateTemplateCategoryRequest.safeParse({ kind: 'EMAIL', name: 'Tax Season' }).success,
    ).toBe(true);
    expect(CreateTemplateCategoryRequest.safeParse({ name: 'Tax Season' }).success).toBe(false);
    expect(
      CreateTemplateCategoryRequest.safeParse({ kind: 'EMAIL', name: 'x'.repeat(101) }).success,
    ).toBe(false);
  });

  it('a custom merge field key is letters, digits and single spaces', () => {
    const ok = (key: string) => SaveCustomMergeFieldRequest.safeParse({ key, label: 'L' }).success;
    expect(ok('Referral Code')).toBe(true);
    expect(ok('Code2')).toBe(true);
    expect(ok('Referral  Code')).toBe(false);
    expect(ok('1Code')).toBe(false);
    expect(ok('Code]')).toBe(false);
    expect(ok('[Code')).toBe(false);
    expect(ok('x'.repeat(41))).toBe(false);
  });

  it('branding changes at least one field and keeps the database’s lengths', () => {
    expect(SaveTemplateBrandingRequest.safeParse({}).success).toBe(false);
    expect(SaveTemplateBrandingRequest.safeParse({ letterheadEnabled: false }).success).toBe(true);
    expect(SaveTemplateBrandingRequest.safeParse({ footerText: 'x'.repeat(1_001) }).success).toBe(
      false,
    );
    expect(SaveTemplateBrandingRequest.safeParse({ disclaimer: null }).success).toBe(true);
  });

  it('an import is HTML or text only', () => {
    const base = { kind: 'LETTER_NOTICE', name: 'Notice', format: 'HTML', content: '<p>Hi</p>' };
    expect(ImportTemplateRequest.safeParse(base).success).toBe(true);
    expect(ImportTemplateRequest.safeParse({ ...base, format: 'DOCX' }).success).toBe(false);
    expect(ImportTemplateRequest.safeParse({ ...base, content: '' }).success).toBe(false);
  });

  it('an attachment is one of five types, up to 10 MB, with its checksum', () => {
    const base = {
      fileName: 'guide.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1000,
      sha256: sha,
    };
    expect(StartTemplateAttachmentRequest.safeParse(base).success).toBe(true);
    expect(
      StartTemplateAttachmentRequest.safeParse({ ...base, contentType: 'text/html' }).success,
    ).toBe(false);
    expect(
      StartTemplateAttachmentRequest.safeParse({ ...base, sizeBytes: 10 * 1024 * 1024 + 1 })
        .success,
    ).toBe(false);
    expect(StartTemplateAttachmentRequest.safeParse({ ...base, sizeBytes: 0 }).success).toBe(false);
    expect(StartTemplateAttachmentRequest.safeParse({ ...base, sha256: 'ABC' }).success).toBe(
      false,
    );
  });

  it('a test send names a channel and the caller’s own destination in a valid form', () => {
    expect(TestSendTemplateRequest.safeParse({ channel: 'EMAIL' }).success).toBe(true);
    expect(
      TestSendTemplateRequest.safeParse({ channel: 'SMS', toPhone: '+15551234567' }).success,
    ).toBe(true);
    expect(
      TestSendTemplateRequest.safeParse({ channel: 'SMS', toPhone: '5551234567' }).success,
    ).toBe(false);
    expect(TestSendTemplateRequest.safeParse({ channel: 'EMAIL', toEmail: 'nope' }).success).toBe(
      false,
    );
  });
});

describe('createTemplatesClient', () => {
  it('calls the routes in the contract and never sends a business id', async () => {
    const f = fakeFetch({ items: [], total: 0, page: 1, pageSize: 10 });
    const client = createTemplatesClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    await client.list({ tab: 'mine', kind: 'EMAIL', tag: 'tax' });
    const url = f.calls[0]?.url ?? '';
    expect(url.startsWith('/api/v1/business/templates?')).toBe(true);
    for (const part of ['tab=mine', 'kind=EMAIL', 'tag=tax', 'sort=updated']) {
      expect(url).toContain(part);
    }
    expect(JSON.stringify(f.calls)).not.toMatch(/businessId|x-business-id/i);
  });

  it('refuses bad input before sending anything', async () => {
    const f = fakeFetch({});
    const client = createTemplatesClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    await expect(client.bulk({ action: 'ARCHIVE', ids: [id] } as never)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    await expect(client.get('nope')).rejects.toMatchObject({ status: 400 });
    await expect(client.version(id, 0)).rejects.toMatchObject({ status: 400 });
    await expect(client.version(id, Number.NaN)).rejects.toMatchObject({ status: 400 });
    await expect(client.create({ kind: 'EMAIL' } as never)).rejects.toMatchObject({ status: 400 });
    expect(f.calls).toHaveLength(0);
  });
});
