// r1_message_thread_lead (R1, Oct 28): a conversation with a lead (the Messages Leads tab). A
// thread belongs to exactly one client or one lead, fixed for its life; an email or text to a lead
// links the copy it wrote in that lead's own thread. Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { createFirms } from './r36-helpers.js';
import { failure } from './r38-helpers.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

let f: Awaited<ReturnType<typeof createFirms>>;
const staff = randomUUID();
const ids = { lead: '', leadB: '', engagement: '', thread: '', message: '', clientMessage: '' };
const A = () => ({ businessId: f.firmA });
const firmA = () => db.forBusiness(f.firmA);
const firmB = () => db.forBusiness(f.firmB);
const thread = (data: Record<string, unknown>) =>
  firmA().messageThread.create({ data: { ...A(), subject: 'Your consultation', ...data } });
const post = (
  threadId: string,
  direction: 'FIRM_TO_CLIENT' | 'CLIENT_TO_FIRM' = 'FIRM_TO_CLIENT',
) =>
  firmA().message.create({
    data: { ...A(), threadId, senderUserId: staff, direction, body: 'Thanks for reaching out' },
  });
const email = () =>
  firmA().outboundMessage.create({
    data: {
      ...A(),
      kind: 'DIRECT',
      channel: 'EMAIL',
      subject: 'Your consultation',
      body: 'Thanks for reaching out',
      createdByUserId: staff,
    },
  });
const recipient = (outboundMessageId: string, data: Record<string, unknown>) =>
  firmA().outboundMessageRecipient.create({
    data: { ...A(), outboundMessageId, channel: 'EMAIL', ...data },
  });

beforeAll(async () => {
  f = await createFirms(owner, 'mtl');
  await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.user.create({
      data: {
        id: staff,
        cognitoSub: staff,
        pool: 'STAFF',
        email: `s-${f.run}@mtl.test`,
        name: 'Fake Staff',
      },
    }),
  );
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, async (tx) => {
    await tx.membership.create({
      data: { ...A(), userId: staff, role: 'STAFF', status: 'ACTIVE' },
    });
    const service = await tx.service.create({
      data: { ...A(), kind: 'ANNUAL_TAX', name: `Tax ${f.run}` },
    });
    ids.lead = (
      await tx.lead.create({
        data: {
          ...A(),
          serviceId: service.id,
          firstName: 'Fake',
          lastName: 'Lead',
          email: `l-${f.run}@mtl.test`,
        },
      })
    ).id;
    ids.engagement = (
      await tx.engagement.create({
        data: { ...A(), clientId: f.client, serviceId: service.id, title: 'Tax' },
      })
    ).id;
    const clientThread = await tx.messageThread.create({
      data: { ...A(), clientId: f.client, subject: 'Hello' },
    });
    ids.clientMessage = (
      await tx.message.create({
        data: {
          ...A(),
          threadId: clientThread.id,
          senderUserId: staff,
          direction: 'FIRM_TO_CLIENT',
          body: 'Hello',
        },
      })
    ).id;
  });
  ids.leadB = (
    await runInScope(owner, { kind: 'business', businessId: f.firmB }, async (tx) => {
      const service = await tx.service.create({
        data: { businessId: f.firmB, kind: 'ANNUAL_TAX', name: `Tax ${f.run}` },
      });
      return tx.lead.create({
        data: {
          businessId: f.firmB,
          serviceId: service.id,
          firstName: 'Other',
          lastName: 'Lead',
          email: `lb-${f.run}@mtl.test`,
        },
      });
    })
  ).id;
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('a lead thread', () => {
  it('belongs to the lead alone, and the firm writes in it', async () => {
    const t = await thread({ leadId: ids.lead });
    expect(t).toMatchObject({ leadId: ids.lead, clientId: null, engagementId: null });
    ids.thread = t.id;
    ids.message = (await post(t.id)).id;
    await expect(
      firmA().messageThread.findUniqueOrThrow({ where: { id: t.id } }),
    ).resolves.toMatchObject({ lastMessageAt: expect.any(Date) });
  });

  it('is a client or a lead, never both or neither, and a lead thread has no engagement', async () => {
    expect(await failure(thread({ clientId: f.client, leadId: ids.lead }))).toMatch(
      /client_or_lead/,
    );
    expect(await failure(thread({}))).toMatch(/client_or_lead/);
    expect(await failure(thread({ leadId: ids.lead, engagementId: ids.engagement }))).toMatch(
      /client_or_lead/,
    );
  });

  it('keeps its lead: neither the lead nor a client can be set later', async () => {
    const t = await thread({ leadId: ids.lead });
    const change = (data: Record<string, unknown>) =>
      firmA().messageThread.update({ where: { id: t.id }, data });
    expect(await failure(change({ leadId: null, clientId: f.client }))).toMatch(/cannot change/);
    expect(await failure(change({ clientId: f.client }))).toMatch(/cannot change|client_or_lead/);
    const c = await thread({ clientId: f.client });
    expect(
      await failure(
        firmA().messageThread.update({ where: { id: c.id }, data: { clientId: null } }),
      ),
    ).toMatch(/cannot change/);
  });

  it('takes no client-side message (a lead has no portal login)', async () => {
    expect(await failure(post(ids.thread, 'CLIENT_TO_FIRM'))).toMatch(/portal login/);
  });
});

describe("an email to a lead links the copy in the lead's own thread", () => {
  it("links the lead's own thread on email, never a client's thread or the portal", async () => {
    const m = await email();
    await expect(
      recipient(m.id, { leadId: ids.lead, messageId: ids.message }),
    ).resolves.toMatchObject({ messageId: ids.message });
    const m2 = await email();
    expect(
      await failure(recipient(m2.id, { leadId: ids.lead, messageId: ids.clientMessage })),
    ).toMatch(/own thread/);
    const portal = await firmA().outboundMessage.create({
      data: { ...A(), kind: 'DIRECT', channel: 'PORTAL', body: 'Hi', createdByUserId: staff },
    });
    expect(
      await failure(
        recipient(portal.id, { channel: 'PORTAL', leadId: ids.lead, messageId: ids.message }),
      ),
    ).toMatch(/own thread/);
  });
});

describe('isolation', () => {
  it("firm B cannot see or change firm A's lead thread", async () => {
    expect(await firmB().messageThread.findMany({ where: { id: ids.thread } })).toEqual([]);
    const { count } = await firmB().messageThread.updateMany({
      where: { id: ids.thread },
      data: { subject: 'Changed' },
    });
    expect(count).toBe(0);
  });

  it("never opens a thread on another firm's lead", async () => {
    expect(await failure(thread({ leadId: ids.leadB }))).toMatch(/foreign key/i);
  });
});
