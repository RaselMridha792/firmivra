// Tax Returns Review 2, Messaging (R60, Nov 15; migration r60_message_email, the lead's approval):
// the firm's defaults for the new-message email to a client, a client's saved preference and the
// choices each firm-to-client message was sent with. Runs as the app role under RLS.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
let threadId = '';

const post = (data: Record<string, unknown>) =>
  A().message.create({
    data: {
      businessId: f.firmA,
      threadId,
      senderUserId: f.memberA,
      direction: 'FIRM_TO_CLIENT',
      body: 'Your organizer is ready (fake)',
      ...data,
    },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r60me');
  threadId = (
    await A().messageThread.create({
      data: { businessId: f.firmA, clientId: f.clientA, subject: 'Organizer (fake)' },
    })
  ).id;
});

describe('message_settings', () => {
  it('sends the email by default, without the text or documents, and no extras without it', async () => {
    const s = await A().messageSettings.create({ data: { businessId: f.firmA } });
    expect([
      s.clientEmailNotice,
      s.clientEmailIncludesBody,
      s.clientEmailIncludesDocuments,
    ]).toEqual([true, false, false]);
    expect(
      await failure(
        A().messageSettings.update({
          where: { businessId: f.firmA },
          data: { clientEmailNotice: false, clientEmailIncludesBody: true },
        }),
      ),
    ).toMatch(/message_settings_client_email_extras/);
  });
});

describe('client_message_preferences', () => {
  it('keeps a client choice per firm, null for the firm default, and stays in its firm', async () => {
    const saved = await A().clientMessagePreference.create({
      data: {
        businessId: f.firmA,
        clientId: f.clientA,
        emailIncludesDocuments: true,
        updatedByUserId: f.memberA,
      },
    });
    expect([saved.emailNotice, saved.emailIncludesBody, saved.emailIncludesDocuments]).toEqual([
      null,
      null,
      true,
    ]);
    expect(
      await failure(
        A().clientMessagePreference.update({
          where: { businessId_clientId: { businessId: f.firmA, clientId: f.clientA } },
          data: { emailNotice: false },
        }),
      ),
    ).toMatch(/client_message_preferences_email_extras/);
    expect(await B().clientMessagePreference.findMany()).toEqual([]);
    expect(
      await failure(
        B().clientMessagePreference.create({
          data: { businessId: f.firmA, clientId: f.clientA, updatedByUserId: f.memberA },
        }),
      ),
    ).toMatch(/row-level security|violates/i);
  });
});

describe('messages', () => {
  it('a firm-to-client message keeps all three choices it was sent with, or none', async () => {
    await expect(
      post({ emailNotice: true, emailIncludesBody: false, emailIncludesDocuments: true }),
    ).resolves.toMatchObject({ emailNotice: true, emailIncludesDocuments: true });
    await expect(post({})).resolves.toMatchObject({ emailNotice: null });
    expect(await failure(post({ emailNotice: true }))).toMatch(/messages_email_choices/);
    expect(
      await failure(
        post({ emailNotice: false, emailIncludesBody: true, emailIncludesDocuments: false }),
      ),
    ).toMatch(/messages_email_choices/);
    // A client's message keeps none (its own trigger refuses a non-client sender first, so the
    // rule is read from the constraint).
    const [c] = await owner.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'messages_email_choices'`;
    expect(c?.def).toContain("'FIRM_TO_CLIENT'");
  });
});
