// Template extras (r39_template_extras): favourites, shares, attachments, the use log, branding
// and custom merge fields are firm-only, and their rules hold.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome } = r39Fixtures(inject('dbUrls'));
let tpl = '';

beforeAll(async () => {
  await setup();
  const data = {
    businessId: A.id,
    kind: 'EMAIL' as const,
    name: 'T',
    body: 'b',
    ownerUserId: A.owner,
  };
  tpl = (await as(A).messageTemplate.create({ data })).id;
  const t = { businessId: A.id, templateId: tpl };
  await as(A).messageTemplateFavorite.create({ data: { ...t, userId: A.owner } });
  await as(A).messageTemplateShare.create({ data: { ...t, userId: A.owner } });
  await as(A).messageTemplateUse.create({ data: { ...t, version: 1, purpose: 'communication' } });
  await as(A).templateBranding.create({ data: { businessId: A.id, footerText: 'Thank you' } });
  await as(A).customMergeField.create({
    data: { businessId: A.id, key: 'Office Hours', label: 'Office hours' },
  });
});
afterAll(close);

describe('row-level security', () => {
  it("hides another firm's rows", async () => {
    const b = as(B);
    expect(await b.messageTemplateFavorite.findMany()).toEqual([]);
    expect(await b.messageTemplateShare.findMany()).toEqual([]);
    expect(await b.messageTemplateAttachment.findMany()).toEqual([]);
    expect(await b.messageTemplateUse.findMany()).toEqual([]);
    expect(await b.templateBranding.findMany()).toEqual([]);
    expect(await b.customMergeField.findMany()).toEqual([]);
  });
  it("refuses writes into, or links to, another firm's rows", async () => {
    const t = { templateId: tpl };
    const use = as(B).messageTemplateUse.create({
      data: { businessId: B.id, ...t, version: 1, purpose: 'x' },
    });
    expect(await outcome(use)).toMatch(/Foreign key/);
    const brand = as(B).templateBranding.create({ data: { businessId: A.id } });
    expect(await outcome(brand)).toMatch(/row-level security/);
  });
});

describe('rules', () => {
  it('shares only with firm members, once, and favourites once per person', async () => {
    const t = { businessId: A.id, templateId: tpl };
    const stranger = as(A).messageTemplateShare.create({ data: { ...t, userId: B.owner } });
    expect(await outcome(stranger)).toMatch(/TEMPLATE_SHARE_MEMBER/);
    const again = as(A).messageTemplateFavorite.create({ data: { ...t, userId: A.owner } });
    expect(await outcome(again)).toMatch(/Unique/i);
  });
  it('keeps the use log insert-only', async () => {
    expect(await outcome(as(A).messageTemplateUse.deleteMany())).toMatch(/permission denied/);
    expect(await outcome(as(A).messageTemplateUse.updateMany({ data: { version: 2 } }))).toMatch(
      /permission denied/,
    );
  });
  it('checks attachments: type, size and key under the firm', async () => {
    const make = (d: object) =>
      outcome(
        as(A).messageTemplateAttachment.create({
          data: {
            businessId: A.id,
            templateId: tpl,
            fileName: 'f.pdf',
            contentType: 'application/pdf',
            sizeBytes: 100,
            s3Key: `tenant/${A.id}/templates/${tpl}/${Math.random()}`,
            ...d,
          },
        }),
      );
    expect(await make({})).toBe('ok');
    expect(await make({ contentType: 'application/x-msdownload' })).toMatch(/attachments_values/);
    expect(await make({ sizeBytes: 10485761 })).toMatch(/attachments_values/);
    expect(await make({ s3Key: `tenant/${B.id}/templates/x` })).toMatch(/attachments_values/);
  });
  it('checks merge field keys and the use purpose', async () => {
    const field = (key: string) =>
      outcome(as(A).customMergeField.create({ data: { businessId: A.id, key, label: 'L' } }));
    expect(await field('Bad]Key')).toMatch(/custom_merge_fields_values/);
    expect(await field('Office Hours')).toMatch(/Unique/i);
    const use = as(A).messageTemplateUse.create({
      data: { businessId: A.id, templateId: tpl, version: 1, purpose: 'Bad Purpose' },
    });
    expect(await outcome(use)).toMatch(/uses_values/);
  });
});
