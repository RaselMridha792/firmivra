// R55 (Intake 1, r55_db_batch section 8): a submit needs no signature when the firm's Require
// Signature switch is off and none was given. With the switch on (or no settings row), or with a
// signature given, the check is as in r0_intake_agreements. Runs as the app role under RLS.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const NEEDS = /needs the signature/;
const ACKS = [{ key: 'read', label: 'I read it', text: 'Synthetic.', required: true }];

type Firm = { id: string; formId: string; versionId: string; bodySha256: string };
const firms: { sw: Firm; none: Firm } = {} as never;

/** A firm with a service, a published form and a firm-wide agreement; made as the owner role. */
async function makeFirm(tag: string): Promise<Firm> {
  const id = (
    await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.business.create({ data: { slug: `iss-${tag}-${run}`, name: tag } }),
    )
  ).id;
  const user = randomUUID();
  await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.user.create({
      data: { id: user, cognitoSub: user, pool: 'STAFF', email: `${user}@iss.test`, name: 'Fake' },
    }),
  );
  return runInScope(owner, { kind: 'business', businessId: id }, async (tx) => {
    const businessId = id;
    await tx.membership.create({
      data: { businessId, userId: user, role: 'OWNER', status: 'ACTIVE' },
    });
    const service = await tx.service.create({
      data: { businessId, kind: 'BOOKKEEPING', name: 'Bookkeeping' },
    });
    const form = await tx.intakeForm.create({
      data: {
        businessId,
        serviceId: service.id,
        version: 1,
        title: 'Intake',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    const agreement = await tx.firmAgreement.create({
      data: { businessId, scope: 'ALL_INTAKES', createdByUserId: user },
    });
    const version = await tx.firmAgreementVersion.create({
      data: {
        businessId,
        agreementId: agreement.id,
        version: 1,
        title: 'Firm-wide',
        bodyMarkdown: 'Synthetic firm-wide text. Not legal text.',
        acknowledgments: ACKS,
        publishedByUserId: user,
      },
    });
    return { id, formId: form.id, versionId: version.id, bodySha256: version.bodySha256 };
  });
}

const inFirm = <T>(firm: Firm, fn: (tx: TxClient) => Promise<T>) =>
  db.withScope({ kind: 'business', businessId: firm.id }, fn);

/** A lead with its intake and a draft submission. */
async function newDraft(firm: Firm) {
  const businessId = firm.id;
  const form = await db.forBusiness(businessId).intakeForm.findUniqueOrThrow({
    where: { id: firm.formId },
  });
  const lead = await db.forBusiness(businessId).lead.create({
    data: {
      businessId,
      serviceId: form.serviceId,
      firstName: 'Lena',
      lastName: 'Lead',
      email: `lead-${randomUUID()}@iss.test`,
    },
  });
  const intake = await db
    .forBusiness(businessId)
    .intake.create({ data: { businessId, formId: firm.formId, leadId: lead.id } });
  const submission = await db.forBusiness(businessId).intakeSubmission.create({
    data: { businessId, intakeId: intake.id, version: 1, answers: { fullName: 'Lena Lead' } },
  });
  return { lead, intake, submission };
}

const setSwitch = (firm: Firm, requireSignature: boolean) =>
  db.forBusiness(firm.id).intakeSettings.upsert({
    where: { businessId: firm.id },
    create: { businessId: firm.id, requireSignature },
    update: { requireSignature },
  });

/** Signs (firm-wide agreement ticked) in the transaction `tx`. */
const signIn = (firm: Firm, tx: TxClient, d: Awaited<ReturnType<typeof newDraft>>) =>
  tx.intakeSignature.create({
    data: {
      businessId: firm.id,
      submissionId: d.submission.id,
      intakeId: d.intake.id,
      leadId: d.lead.id,
      printedName: 'Lena Lead',
      signatureText: 'Lena Lead',
      answersSha256: sha('answers'),
      evidenceSha256: sha('evidence'),
      ip: '203.0.113.7',
      userAgent: 'Test browser',
      acknowledgments: [{ agreementVersionId: firm.versionId, ...ACKS[0], checked: true }],
      agreements: {
        create: [{ agreementVersionId: firm.versionId, bodySha256: firm.bodySha256 }],
      },
    },
  });

/** Submits with whatever evidence is given (none: the three signer fields stay null). */
const submit = (
  tx: TxClient,
  id: string,
  evidence: { name: string; at: Date; ip: string | null; ua: string | null } | null,
) =>
  tx.intakeSubmission.update({
    where: { id },
    data: {
      submittedAt: new Date(),
      ...(evidence
        ? {
            signerName: evidence.name,
            signedAt: evidence.at,
            signerIp: evidence.ip,
            signerUserAgent: evidence.ua,
          }
        : {}),
    },
  });

beforeAll(async () => {
  firms.sw = await makeFirm('sw');
  firms.none = await makeFirm('none');
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('Require Signature off', () => {
  it('lets a submit through with no signature, and the signer fields stay null', async () => {
    await setSwitch(firms.sw, false);
    const d = await newDraft(firms.sw);
    const submitted = await inFirm(firms.sw, (tx) => submit(tx, d.submission.id, null));
    expect(submitted.submittedAt).not.toBeNull();
    expect(submitted).toMatchObject({ signerName: null, signerIp: null, signerUserAgent: null });
  });

  it('still refuses a signature that does not match (wrong name or time)', async () => {
    await setSwitch(firms.sw, false);
    for (const change of [{ name: 'Someone Else' }, { at: new Date('2000-01-01') }]) {
      const d = await newDraft(firms.sw);
      await expect(
        inFirm(firms.sw, async (tx) => {
          const sig = await signIn(firms.sw, tx, d);
          return submit(tx, d.submission.id, {
            name: sig.printedName,
            at: sig.signedAt,
            ip: sig.ip,
            ua: sig.userAgent,
            ...change,
          });
        }),
      ).rejects.toThrow(NEEDS);
    }
  });

  it('still accepts a correct signature', async () => {
    await setSwitch(firms.sw, false);
    const d = await newDraft(firms.sw);
    const submitted = await inFirm(firms.sw, async (tx) => {
      const sig = await signIn(firms.sw, tx, d);
      return submit(tx, d.submission.id, {
        name: sig.printedName,
        at: sig.signedAt,
        ip: sig.ip,
        ua: sig.userAgent,
      });
    });
    expect(submitted.signerName).toBe('Lena Lead');
  });
});

describe('Require Signature on, or no settings row', () => {
  it('refuses a submit without a signature when the switch is on', async () => {
    await setSwitch(firms.sw, true);
    const d = await newDraft(firms.sw);
    const failure = await inFirm(firms.sw, (tx) => submit(tx, d.submission.id, null)).catch(
      (e: { message: string; meta?: unknown }) => e,
    );
    expect(String((failure as Error).message)).toMatch(NEEDS);
    expect(JSON.stringify(failure)).toMatch(/23514|check_violation/);
  });

  it('refuses it when the firm has no settings row (on by default)', async () => {
    const d = await newDraft(firms.none);
    await expect(inFirm(firms.none, (tx) => submit(tx, d.submission.id, null))).rejects.toThrow(
      NEEDS,
    );
  });
});
