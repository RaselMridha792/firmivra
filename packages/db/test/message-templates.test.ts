// Message templates (r39_message_templates): firm-only rows (RLS, same-firm keys), insert-only
// versions, a category of the template's own kind, and checked text and tags.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome } = r39Fixtures(inject('dbUrls'));
let tpl = '';
let cat = '';
const mk = (f = A, data: object = {}) =>
  as(f).messageTemplate.create({
    data: { businessId: f.id, kind: 'EMAIL', name: 'N', body: 'b', ownerUserId: f.owner, ...data },
  });

beforeAll(async () => {
  await setup();
  const kind = 'EMAIL';
  cat = (await as(A).templateCategory.create({ data: { businessId: A.id, kind, name: 'Tax' } })).id;
  tpl = (await mk(A, { categoryId: cat, name: 'Organizer', tags: ['tax', 'organizer'] })).id;
  const data = { businessId: A.id, templateId: tpl, version: 1, name: 'Organizer', body: 'b' };
  await as(A).messageTemplateVersion.create({ data: { ...data, savedByUserId: A.owner } });
});
afterAll(close);

describe('row-level security', () => {
  it("hides another firm's rows and refuses writes into them", async () => {
    expect(await as(B).templateCategory.findMany()).toEqual([]);
    expect(await as(B).messageTemplate.findMany()).toEqual([]);
    expect(await as(B).messageTemplateVersion.findMany()).toEqual([]);
    const kind = 'EMAIL';
    const into = as(B).templateCategory.create({ data: { businessId: A.id, kind, name: 'X' } });
    expect(await outcome(into)).toMatch(/row-level security/);
  });
  it("refuses a link to another firm's category or template", async () => {
    expect(await outcome(mk(B, { categoryId: cat }))).toMatch(/Foreign key|TEMPLATE_CATEGORY_KIND/);
    const data = { businessId: B.id, templateId: tpl, version: 9, name: 'n', body: 'b' };
    const v = as(B).messageTemplateVersion.create({ data: { ...data, savedByUserId: B.owner } });
    expect(await outcome(v)).toMatch(/Foreign key/);
  });
});

describe('rules', () => {
  it('keeps versions insert-only and numbered once', async () => {
    const where = {
      businessId_templateId_version: { businessId: A.id, templateId: tpl, version: 1 },
    };
    expect(
      await outcome(as(A).messageTemplateVersion.update({ where, data: { name: 'Z' } })),
    ).toMatch(/permission denied/);
    const data = { businessId: A.id, templateId: tpl, version: 1, name: 'n', body: 'b' };
    const again = as(A).messageTemplateVersion.create({
      data: { ...data, savedByUserId: A.owner },
    });
    expect(await outcome(again)).toMatch(/Unique/i);
  });
  it('needs a category of the same kind and a version that moves forward', async () => {
    expect(await outcome(mk(A, { kind: 'SMS', categoryId: cat }))).toMatch(
      /TEMPLATE_CATEGORY_KIND/,
    );
    await as(A).messageTemplate.update({ where: { id: tpl }, data: { version: 2 } });
    const back = as(A).messageTemplate.update({ where: { id: tpl }, data: { version: 1 } });
    expect(await outcome(back)).toMatch(/TEMPLATE_VERSION/);
  });
  it('checks names, tags, archive state and the starter key', async () => {
    for (const bad of [
      { name: '  ' },
      { tags: ['a', 'A'] },
      { status: 'ARCHIVED' },
      { starterKey: 'Bad Key' },
    ]) {
      expect(await outcome(mk(A, bad))).toMatch(/message_templates_values/);
    }
    expect(await outcome(mk(A, { starterKey: 'welcome', name: 'W' }))).toBe('ok');
    expect(await outcome(mk(A, { starterKey: 'welcome', name: 'W2' }))).toMatch(/Unique/i);
  });
  it('is never deleted by the app', async () => {
    expect(await outcome(as(A).messageTemplate.delete({ where: { id: tpl } }))).toMatch(
      /permission denied/,
    );
  });
});
