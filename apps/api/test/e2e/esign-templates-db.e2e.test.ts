// End-to-end over the real database: Firm Sign templates (PrismaTemplateRepository, r0_esign)
// through the real guards, row-level security and database rules. Only the file store and the
// email sender are in memory. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type EsignDbWorld, esignDbWorld, readyDraft } from './esign-db.js';

let w: EsignDbWorld;
const esign = '/api/v1/esign';
const base = `${esign}/requests`;
const code = (res: { body: unknown }) => (res.body as { error?: { code?: string } }).error?.code;

beforeAll(async () => {
  w = await esignDbWorld('r13-templates-db');
});
afterAll(async () => {
  await w?.close();
});

const request = (id: string) =>
  w.inFirm(w.a.id, (tx) =>
    tx.esignRequest.findUniqueOrThrow({
      where: { id },
      include: { recipients: true },
    }),
  );

describe('Firm Sign templates on PostgreSQL', () => {
  it('saves a template, adds and restores a version, uses it and archives it', async () => {
    const owner = w.a.people.owner;
    const d = await readyDraft(w, w.a, 'Fake template source', {
      upload: true,
    });
    const saved = await w.call('post', `${base}/${d.id}/save-as-template`, owner, {
      name: 'Fake engagement template',
      visibility: 'FIRM',
    });
    expect(saved.status).toBe(201);
    const templateId = (saved.body as { id: string }).id;
    const dup = await w.call('post', `${base}/${d.id}/save-as-template`, owner, {
      name: 'Fake engagement template',
    });
    expect([dup.status, code(dup)]).toEqual([409, 'TEMPLATE_NAME_TAKEN']);

    const version = await w.call('post', `${base}/${d.id}/save-as-version`, owner, {
      templateId,
      note: 'Fake second version',
    });
    expect(version.status).toBe(201);
    const versions = await w.call('get', `${esign}/templates/${templateId}/versions`, owner);
    const listed = (versions.body as { items: { version: number }[] }).items;
    expect(listed.map((v) => v.version)).toEqual([2, 1]);
    const list = await w.call('get', `${esign}/templates?q=engagement`, owner);
    expect((list.body as { items: { id: string }[] }).items.map((t) => t.id)).toContain(templateId);
    // Firm B sees none of it.
    expect((await w.call('get', `${esign}/templates/${templateId}`, w.b.people.owner)).status).toBe(
      404,
    );

    const used = await w.call('post', `${esign}/templates/${templateId}/use`, owner, {
      clientId: w.a.ids.client,
      engagementId: w.a.ids.engagement,
    });
    expect(used.status).toBe(201);
    const draft = await request((used.body as { id: string }).id);
    expect([draft.status, draft.templateId, draft.templateVersion]).toEqual([
      'DRAFT',
      templateId,
      2,
    ]);

    // Restoring version 1 adds version 3 with its own copy of the packet (s3_key is unique).
    const restored = await w.call(
      'post',
      `${esign}/templates/${templateId}/versions/1/restore`,
      owner,
      {},
    );
    expect(restored.status).toBe(201);
    const files = await w.inFirm(w.a.id, (tx) =>
      tx.esignTemplateVersion.findMany({
        where: { templateId },
        orderBy: { version: 'asc' },
      }),
    );
    expect(files.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(files[2]!.sha256).toBe(files[0]!.sha256);
    expect(files[2]!.s3Key).not.toBe(files[0]!.s3Key);

    const archived = await w.call('post', `${esign}/templates/${templateId}/archive`, owner, {});
    expect(archived.status).toBe(200);
  });
});
