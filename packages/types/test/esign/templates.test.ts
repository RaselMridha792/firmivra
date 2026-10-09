import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  createEsignClient,
  createRequest,
  ESIGN_ERRORS,
  EsignBulkRoleFill,
  EsignBulkSendBody,
  EsignErrorCode,
  EsignTemplateRoleFill,
  SaveEsignTemplateBody,
  SaveEsignTemplateVersionBody,
  UseEsignTemplateBody,
} from '../../src/index.js';

// Template contract follow-ups (R13): save-as-template's default and refusals, the template
// packet's address, and access codes and delivery when a template is used or bulk-sent.

const id = '0199b6e0-0000-7000-8000-000000000001';
const other = '0199b6e0-0000-7000-8000-000000000002';
const external = { type: 'EXTERNAL', name: 'Pat Sample', email: 'pat@example.test' } as const;

describe('save as template', () => {
  it('is PRIVATE unless asked', () => {
    expect(SaveEsignTemplateBody.parse({ name: 'Engagement letter' }).visibility).toBe('PRIVATE');
    expect(SaveEsignTemplateBody.parse({ name: 'Letter', visibility: 'FIRM' }).visibility).toBe(
      'FIRM',
    );
  });

  it('drops the sender’s typed values unless the body keeps them', () => {
    expect(SaveEsignTemplateBody.parse({ name: 'Letter' }).keepSenderValues).toBe(false);
    expect(SaveEsignTemplateBody.parse({ name: 'Letter', keepSenderValues: false })).toMatchObject({
      keepSenderValues: false,
    });
    expect(
      SaveEsignTemplateBody.parse({ name: 'Letter', keepSenderValues: true }).keepSenderValues,
    ).toBe(true);
    expect(
      SaveEsignTemplateBody.safeParse({ name: 'Letter', keepSenderValues: 'yes' }).success,
    ).toBe(false);
    // save-as-version copies the same way.
    expect(SaveEsignTemplateVersionBody.parse({ templateId: id }).keepSenderValues).toBe(false);
    expect(
      SaveEsignTemplateVersionBody.parse({ templateId: id, keepSenderValues: true })
        .keepSenderValues,
    ).toBe(true);
  });

  it('has a code and words for a client’s files', () => {
    expect(EsignErrorCode.safeParse('TEMPLATE_HAS_CLIENT_FILES').success).toBe(true);
    expect(ESIGN_ERRORS.TEMPLATE_HAS_CLIENT_FILES).toBe(
      "Files from the client's documents can't go into a template. Upload a blank copy instead.",
    );
  });
});

describe('the template packet', () => {
  it('builds the same-site address without a call', () => {
    let called = false;
    const fn = (async () => {
      called = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    const api = createEsignClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
    expect(api.templates.packetUrl(id)).toBe(`/api/v1/esign/templates/${id}/packet`);
    expect(called).toBe(false);
  });

  it('refuses a bad id', () => {
    const api = createEsignClient(createRequest({ baseUrl: '/api/v1', fetch }));
    expect(() => api.templates.packetUrl('nope')).toThrow(ApiRequestError);
  });
});

describe('filling template roles', () => {
  const ok = (fill: unknown) => EsignTemplateRoleFill.safeParse(fill).success;

  it('takes who, delivery and an access code', () => {
    expect(
      ok({ key: 'witness', who: external, authMethod: 'ACCESS_CODE', accessCode: 'Ab12' }),
    ).toBe(true);
    // Only the code: the CLIENT role keeps filling itself from the client's login.
    expect(ok({ key: 'client', accessCode: 'Ab12' })).toBe(true);
    expect(ok({ key: 'client', delivery: 'IN_PERSON' })).toBe(true);
  });

  it('follows the recipient rules', () => {
    // ACCESS_CODE needs a code, unless the signer signs in person.
    expect(ok({ key: 'witness', who: external, authMethod: 'ACCESS_CODE' })).toBe(false);
    expect(
      ok({ key: 'witness', who: external, authMethod: 'ACCESS_CODE', delivery: 'IN_PERSON' }),
    ).toBe(true);
    expect(ok({ key: 'witness', who: external, accessCode: 'a!' })).toBe(false);
    // PORTAL is only for a client's own login.
    expect(ok({ key: 'witness', who: external, delivery: 'PORTAL' })).toBe(false);
    expect(
      ok({ key: 'client', who: { type: 'CLIENT_LOGIN', clientAccountId: id }, delivery: 'PORTAL' }),
    ).toBe(true);
    // A fill that fills nothing.
    expect(ok({ key: 'witness' })).toBe(false);
  });

  it('carries the fills in use', () => {
    const body = UseEsignTemplateBody.parse({
      clientId: other,
      roles: [{ key: 'client', authMethod: 'ACCESS_CODE', accessCode: 'Ab12' }],
    });
    expect(body.roles).toEqual([{ key: 'client', authMethod: 'ACCESS_CODE', accessCode: 'Ab12' }]);
  });

  it('uses the same rules in bulk send, never a client login', () => {
    const bulk = (roles: unknown[]) =>
      EsignBulkSendBody.safeParse({ clients: [{ clientId: id }], roles, confirm: true }).success;
    expect(bulk([{ key: 'client', delivery: 'IN_PERSON' }])).toBe(true);
    expect(bulk([{ key: 'witness', who: external, authMethod: 'EMAIL_CODE' }])).toBe(true);
    expect(bulk([{ key: 'witness', who: external, delivery: 'PORTAL' }])).toBe(false);
    expect(bulk([{ key: 'client', who: { type: 'CLIENT_LOGIN', clientAccountId: id } }])).toBe(
      false,
    );
  });

  it('refuses access codes in bulk send: every client would share one', () => {
    const message =
      'A bulk send can’t use an access code: every client would share it. Choose another check';
    const code = EsignBulkRoleFill.safeParse({ key: 'client', accessCode: 'Ab12' });
    expect(code.success).toBe(false);
    expect(code.error?.issues).toEqual([
      expect.objectContaining({ path: ['accessCode'], message }),
    ]);
    const method = EsignBulkRoleFill.safeParse({
      key: 'witness',
      who: external,
      authMethod: 'ACCESS_CODE',
      accessCode: 'Ab12',
    });
    expect(method.success).toBe(false);
    const alone = EsignBulkRoleFill.safeParse({
      key: 'witness',
      who: external,
      authMethod: 'ACCESS_CODE',
    });
    expect(alone.error?.issues).toEqual([
      expect.objectContaining({ path: ['authMethod'], message }),
    ]);
    // The same fill is fine when the template is used for one client.
    expect(EsignTemplateRoleFill.safeParse({ key: 'client', accessCode: 'Ab12' }).success).toBe(
      true,
    );
  });
});
