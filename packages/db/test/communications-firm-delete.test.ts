// R0 stage B6 (Oct 18): Firmivra's correspondence with a firm outlives the firm. Deleting it
// (app_delete_business_data, as the migrate role runs on RDS: no superuser, no BYPASSRLS) clears
// only the firm links on the conversation, its recipients and a broadcast's recipients; the
// messages and their results stay.
//
// Its own database (not the suite's shared `dbUrls`): app_delete_business_data takes ACCESS
// EXCLUSIVE locks on every firm table while it runs.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, runInScope } from '../src/client.js';
import { prepareTestDatabase, TEST_CLIENT_OPTIONS } from '../src/testing.js';

const SLOW = 300_000;
let owner: ReturnType<typeof createPrismaClient>;
const run = randomUUID().slice(0, 8);

beforeAll(async () => {
  const urls = await prepareTestDatabase('comm_delete');
  owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
}, SLOW);

afterAll(async () => {
  await owner?.$disconnect();
});

describe('deleting a firm Firmivra corresponded with', () => {
  it(
    'clears the firm links and keeps the thread, messages, broadcast and results',
    async () => {
      const contact = {
        contactType: 'FIRM' as const,
        name: 'Avery Stone',
        address: 'avery@leaving.test',
      };
      const made = await runInScope(owner, { kind: 'platform' }, async (tx) => {
        const firm = await tx.business.create({ data: { slug: `b6-del-${run}`, name: 'Leaving' } });
        const conversation = await tx.commConversation.create({
          data: {
            contactType: 'FIRM',
            linkedBusinessId: firm.id,
            contactName: contact.name,
            contactEmail: contact.address,
          },
        });
        const message = await tx.commMessage.create({
          data: {
            conversationId: conversation.id,
            channel: 'EMAIL',
            direction: 'OUTBOUND',
            subject: 'Hello',
            body: 'Hello',
            recipients: { create: [{ ...contact, linkedBusinessId: firm.id }] },
          },
        });
        await tx.commMessage.update({ where: { id: message.id }, data: { status: 'SENDING' } });
        await tx.commMessage.update({ where: { id: message.id }, data: { status: 'SENT' } });
        const segment = await tx.commSegment.create({
          data: { name: `Leaving ${run}`, definition: {} },
        });
        const broadcast = await tx.commBroadcast.create({
          data: {
            name: 'Update',
            segmentId: segment.id,
            recipientCount: 1,
            channels: { create: [{ channel: 'EMAIL', subject: 'Update', body: 'News' }] },
          },
        });
        await tx.commBroadcast.update({ where: { id: broadcast.id }, data: { status: 'SENDING' } });
        await tx.commBroadcastRecipient.create({
          data: {
            ...contact,
            broadcastId: broadcast.id,
            channel: 'EMAIL',
            linkedBusinessId: firm.id,
          },
        });
        await tx.commBroadcast.update({ where: { id: broadcast.id }, data: { status: 'SENT' } });
        return { firm, conversation, message, broadcast };
      });

      const role = `fv_b6del_${run}`;
      const [me] = await owner.$queryRaw<{ owner: string }[]>`SELECT current_user AS owner`;
      await owner.$executeRawUnsafe(`CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS NOLOGIN`);
      await owner.$executeRawUnsafe(`GRANT "${me!.owner}" TO ${role}`);
      try {
        await owner.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
            await tx.$queryRaw`SELECT * FROM app_delete_business_data(${made.firm.id}::uuid)`;
          },
          { timeout: SLOW },
        );
      } finally {
        await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
      }

      const kept = await runInScope(owner, { kind: 'platform' }, async (tx) => ({
        conversation: await tx.commConversation.findUniqueOrThrow({
          where: { id: made.conversation.id },
        }),
        message: await tx.commMessage.findUniqueOrThrow({
          where: { id: made.message.id },
          include: { recipients: true },
        }),
        broadcast: await tx.commBroadcast.findUniqueOrThrow({
          where: { id: made.broadcast.id },
          include: { recipients: true },
        }),
      }));
      expect(kept.conversation.linkedBusinessId).toBeNull();
      expect(kept.message.status).toBe('SENT');
      expect(kept.message.recipients.map((r) => r.linkedBusinessId)).toEqual([null]);
      expect(kept.broadcast.status).toBe('SENT');
      expect(kept.broadcast.recipients.map((r) => r.linkedBusinessId)).toEqual([null]);
    },
    SLOW,
  );
});
