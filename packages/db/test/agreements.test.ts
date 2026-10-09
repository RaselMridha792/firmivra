// r0_intake_agreements: firm agreements (series, PDF originals, insert-only versions) and the
// intake signature evidence that a submit needs. Runs as the app role, except where the owner
// role shows that even it cannot change evidence.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ids = {
  firmA: '',
  firmB: '',
  ownerA: randomUUID(),
  ownerB: randomUUID(),
  clientUserA: randomUUID(),
  clientUserA2: randomUUID(),
  clientAccountA: '',
  otherClientAccountA: '',
  tax: '',
  bookkeeping: '',
  engagement: '',
  taxForm: '',
  bookkeepingForm: '',
  termsA: '',
  privacyA: '',
  termsB: '',
  firmWideA: '',
  firmWideB: '',
  serviceB: '',
};

/** The published intake form of each service of firm A. */
const forms: Record<string, string> = {};

const A = () => ({ businessId: ids.firmA });
/** One transaction in firm A, optionally as a signed-in user. */
const inA = <T>(fn: (tx: TxClient) => Promise<T>, actorUserId?: string) =>
  db.withScope({ kind: 'business', businessId: ids.firmA, actorUserId }, fn);
const firmA = () => db.forBusiness(ids.firmA);
const firmB = () => db.forBusiness(ids.firmB);

const ACKS = [
  { key: 'read', label: 'I read it', text: 'Synthetic acknowledgment one.', required: true },
  { key: 'accurate', label: 'Accurate', text: 'Synthetic acknowledgment two.', required: true },
  { key: 'contact', label: 'Contact me', text: 'Synthetic optional consent.', required: false },
];

const newAgreement = (data: { scope?: 'ALL_INTAKES' | 'SERVICE'; serviceId?: string } = {}) =>
  firmA().firmAgreement.create({
    data: {
      ...A(),
      scope: data.scope ?? 'SERVICE',
      serviceId: data.scope === 'ALL_INTAKES' ? null : (data.serviceId ?? ids.bookkeeping),
      createdByUserId: ids.ownerA,
    },
  });

const publish = (
  agreementId: string,
  version: number,
  data: {
    body?: string;
    acknowledgments?: object[];
    pdfFileId?: string;
    pdfSha256?: string;
    bodySha256?: string;
  } = {},
) =>
  firmA().firmAgreementVersion.create({
    data: {
      ...A(),
      agreementId,
      version,
      title: `Agreement v${version}`,
      bodyMarkdown: data.body ?? `# Synthetic agreement v${version}\n\nNot legal text.`,
      acknowledgments: data.acknowledgments ?? ACKS,
      pdfFileId: data.pdfFileId,
      pdfSha256: data.pdfSha256,
      ...(data.bodySha256 ? { bodySha256: data.bodySha256 } : {}),
      publishedByUserId: ids.ownerA,
    },
  });

const newFile = (data: { s3Key?: string; contentType?: string; sizeBytes?: number } = {}) => {
  const id = randomUUID();
  return firmA().firmAgreementFile.create({
    data: {
      ...A(),
      id,
      fileName: 'agreement.pdf',
      contentType: data.contentType,
      sizeBytes: data.sizeBytes ?? 4096,
      sha256: sha(id),
      s3Key: data.s3Key ?? `tenant/${ids.firmA}/agreements/${id}`,
      uploadedByUserId: ids.ownerA,
    },
  });
};
const scan = (id: string, scanStatus: 'CLEAN' | 'INFECTED') =>
  firmA().firmAgreementFile.update({ where: { id }, data: { scanStatus, scannedAt: new Date() } });

/** The current firm-wide version of firm A. */
const firmWideVersion = () =>
  firmA().firmAgreementVersion.findFirstOrThrow({
    where: { agreementId: ids.firmWideA },
    orderBy: { version: 'desc' },
  });

/** A new service of firm A with a published intake form, so no other test's agreements apply. */
const newService = () =>
  runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const service = await tx.service.create({
      data: { ...A(), kind: 'BOOKKEEPING', name: `Bookkeeping ${randomUUID()}` },
    });
    forms[service.id] = (
      await tx.intakeForm.create({
        data: {
          ...A(),
          serviceId: service.id,
          version: 1,
          title: 'Intake',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      })
    ).id;
    return service.id;
  });

/** A Begin Online lead for a service with its intake and draft v1. */
const newLeadDraft = async (serviceId = ids.bookkeeping) => {
  const formId = forms[serviceId] ?? '';
  const lead = await firmA().lead.create({
    data: {
      ...A(),
      serviceId,
      firstName: 'Lena',
      lastName: 'Lead',
      email: `lead-${randomUUID()}@begin.test`,
    },
  });
  const intake = await firmA().intake.create({ data: { ...A(), formId, leadId: lead.id } });
  const submission = await firmA().intakeSubmission.create({
    data: { ...A(), intakeId: intake.id, version: 1, answers: { fullName: 'Lena Lead' } },
  });
  return { lead, intake, submission };
};

type Version = {
  id: string;
  bodySha256: string;
  pdfSha256: string | null;
  acknowledgments: unknown;
};
const ticks = (v: Version, only?: string[]) =>
  (v.acknowledgments as typeof ACKS)
    .filter((a) => !only || only.includes(a.key))
    .map((a) => ({ agreementVersionId: v.id, ...a, checked: true }));

const signature = (
  draft: { intake: { id: string }; submission: { id: string }; lead?: { id: string } },
  data: Record<string, unknown> = {},
) => ({
  ...A(),
  submissionId: draft.submission.id,
  intakeId: draft.intake.id,
  leadId: draft.lead?.id,
  printedName: 'Lena Lead',
  signatureText: 'Lena Lead',
  answersSha256: sha('answers'),
  evidenceSha256: sha('evidence'),
  ip: '203.0.113.7',
  userAgent: 'Test browser',
  ...data,
});

/** Signs a draft for the given versions, ticking every acknowledgment shown. */
const signIn = (
  tx: TxClient,
  draft: Parameters<typeof signature>[0],
  versions: Version[],
  data: Record<string, unknown> = {},
) =>
  tx.intakeSignature.create({
    data: {
      ...signature(draft, { acknowledgments: versions.flatMap((v) => ticks(v)), ...data }),
      agreements: {
        create: versions.map((v) => ({
          agreementVersionId: v.id,
          bodySha256: v.bodySha256,
          pdfSha256: v.pdfSha256,
        })),
      },
    },
  });

/** Signs in a transaction of its own (as `actorUserId`, for a portal login). */
const sign = (
  draft: Parameters<typeof signature>[0],
  versions: Version[],
  data: Record<string, unknown> = {},
  actorUserId?: string,
) => inA((tx) => signIn(tx, draft, versions, data), actorUserId);

type Evidence = {
  printedName: string;
  signedAt: Date;
  ip: string | null;
  userAgent: string | null;
};
const submitIn = (tx: TxClient, submissionId: string, sig: Evidence) =>
  tx.intakeSubmission.update({
    where: { id: submissionId },
    data: {
      submittedAt: sig.signedAt,
      signerName: sig.printedName,
      signedAt: sig.signedAt,
      signerIp: sig.ip,
      signerUserAgent: sig.userAgent,
    },
  });
const submit = (submissionId: string, sig: Evidence) =>
  inA((tx) => submitIn(tx, submissionId, sig));

/** Signs and submits in one transaction, as the API does; `change` alters the submitted evidence. */
const signAndSubmit = (
  draft: Parameters<typeof signature>[0],
  versions: Version[],
  options: {
    data?: Record<string, unknown>;
    change?: Partial<Evidence>;
    actorUserId?: string;
  } = {},
) =>
  inA(async (tx) => {
    const sig = await signIn(tx, draft, versions, options.data);
    const submitted = await submitIn(tx, draft.submission.id, { ...sig, ...options.change });
    return { sig, submitted };
  }, options.actorUserId);

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [id, pool] of [
      [ids.ownerA, 'STAFF'],
      [ids.ownerB, 'STAFF'],
      [ids.clientUserA, 'CLIENT'],
      [ids.clientUserA2, 'CLIENT'],
    ] as const) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool, email: `${id}@agreements.test`, name: 'Fake Person' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `ag-a-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `ag-b-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const businessId = ids.firmA;
    await tx.membership.create({
      data: { businessId, userId: ids.ownerA, role: 'OWNER', status: 'ACTIVE' },
    });
    const service = (kind: 'ANNUAL_TAX' | 'BOOKKEEPING', name: string) =>
      tx.service.create({ data: { businessId, kind, name } });
    ids.tax = (await service('ANNUAL_TAX', 'Annual Tax')).id;
    ids.bookkeeping = (await service('BOOKKEEPING', 'Bookkeeping')).id;
    const form = (serviceId: string) =>
      tx.intakeForm.create({
        data: {
          businessId,
          serviceId,
          version: 1,
          title: 'Intake',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      });
    ids.taxForm = (await form(ids.tax)).id;
    ids.bookkeepingForm = (await form(ids.bookkeeping)).id;
    forms[ids.tax] = ids.taxForm;
    forms[ids.bookkeeping] = ids.bookkeepingForm;
    const client1 = await tx.client.create({ data: { businessId, displayName: 'One' } });
    const client2 = await tx.client.create({ data: { businessId, displayName: 'Two' } });
    ids.engagement = (
      await tx.engagement.create({
        data: { businessId, clientId: client1.id, serviceId: ids.tax, title: '2025' },
      })
    ).id;
    const account = (userId: string, clientId: string) =>
      tx.clientAccount.create({
        data: {
          businessId,
          userId,
          clientId,
          email: `${userId}@agreements.test`,
          status: 'ACTIVE',
        },
      });
    ids.clientAccountA = (await account(ids.clientUserA, client1.id)).id;
    ids.otherClientAccountA = (await account(ids.clientUserA2, client2.id)).id;
    const legal = (kind: 'TERMS' | 'PRIVACY') =>
      tx.firmLegalDocument.create({
        data: { businessId, kind, version: 1, body: 'x', publishedByUserId: ids.ownerA },
      });
    ids.termsA = (await legal('TERMS')).id;
    ids.privacyA = (await legal('PRIVACY')).id;
    ids.firmWideA = (
      await tx.firmAgreement.create({
        data: { businessId, scope: 'ALL_INTAKES', createdByUserId: ids.ownerA },
      })
    ).id;
    await tx.firmAgreementVersion.create({
      data: {
        businessId,
        agreementId: ids.firmWideA,
        version: 1,
        title: 'Firm-wide',
        bodyMarkdown: 'Synthetic firm-wide text. Not legal text.',
        acknowledgments: ACKS,
        publishedByUserId: ids.ownerA,
      },
    });
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const businessId = ids.firmB;
    await tx.membership.create({
      data: { businessId, userId: ids.ownerB, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.serviceB = (
      await tx.service.create({ data: { businessId, kind: 'BOOKKEEPING', name: 'Bookkeeping' } })
    ).id;
    ids.termsB = (
      await tx.firmLegalDocument.create({
        data: { businessId, kind: 'TERMS', version: 1, body: 'x', publishedByUserId: ids.ownerB },
      })
    ).id;
    ids.firmWideB = (
      await tx.firmAgreement.create({
        data: { businessId, scope: 'ALL_INTAKES', createdByUserId: ids.ownerB },
      })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('firm agreements', () => {
  it('a service agreement names a service; the firm-wide one does not; one firm-wide per firm', async () => {
    await expect(
      firmA().firmAgreement.create({
        data: { ...A(), scope: 'SERVICE', createdByUserId: ids.ownerA },
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      firmA().firmAgreement.create({
        data: { ...A(), scope: 'ALL_INTAKES', serviceId: ids.tax, createdByUserId: ids.ownerA },
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(newAgreement({ scope: 'ALL_INTAKES' })).rejects.toThrow(/unique/i);
  });

  it('only the order and the archive time change, and archiving is once', async () => {
    const a = await newAgreement();
    await firmA().firmAgreement.update({ where: { id: a.id }, data: { sortOrder: 3 } });
    await expect(
      firmA().firmAgreement.update({ where: { id: a.id }, data: { serviceId: ids.tax } }),
    ).rejects.toThrow(/permission denied|only the order/);
    const archived = await firmA().firmAgreement.update({
      where: { id: a.id },
      data: { archivedAt: new Date('2000-01-01') },
    });
    // The database's time, whatever the app sent.
    expect(archived.archivedAt?.getFullYear()).toBeGreaterThan(2000);
    await expect(
      firmA().firmAgreement.update({ where: { id: a.id }, data: { archivedAt: null } }),
    ).rejects.toThrow(/stays archived/);
    await expect(firmA().firmAgreement.delete({ where: { id: a.id } })).rejects.toThrow(
      /permission denied/,
    );
    await expect(publish(a.id, 1)).rejects.toThrow(/archived/);
  });

  it('a service agreement is for a service of the same firm', async () => {
    await expect(newAgreement({ serviceId: ids.serviceB })).rejects.toThrow(/foreign key/i);
  });
});

describe('agreement PDF originals', () => {
  it('PDF only, at most 10 MB, under the firm agreements prefix, starting unscanned', async () => {
    await expect(newFile({ contentType: 'application/msword' })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(newFile({ sizeBytes: 10_485_761 })).rejects.toThrow(/check constraint/i);
    await expect(newFile({ s3Key: `tenant/${ids.firmA}/documents/x` })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(newFile({ s3Key: `tenant/${ids.firmB}/agreements/x` })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(
      firmA().firmAgreementFile.create({
        data: {
          ...A(),
          fileName: 'a.pdf',
          sizeBytes: 1,
          sha256: sha('x'),
          s3Key: `tenant/${ids.firmA}/agreements/${randomUUID()}`,
          scanStatus: 'CLEAN',
          scannedAt: new Date(),
          uploadedByUserId: ids.ownerA,
        },
      }),
    ).rejects.toThrow(/starts unscanned/);
  });

  it('the file is fixed and the scan result is set once; never deleted', async () => {
    const f = await newFile();
    await expect(
      firmA().firmAgreementFile.update({ where: { id: f.id }, data: { fileName: 'b.pdf' } }),
    ).rejects.toThrow(/permission denied/);
    const scanned = await firmA().firmAgreementFile.update({
      where: { id: f.id },
      data: { scanStatus: 'CLEAN', scannedAt: new Date('2000-01-01') },
    });
    expect(scanned.scannedAt?.getFullYear()).toBeGreaterThan(2000);
    await expect(scan(f.id, 'INFECTED')).rejects.toThrow(/cannot change/);
    await expect(firmA().firmAgreementFile.delete({ where: { id: f.id } })).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('agreement versions', () => {
  it('are numbered in order and hashed by the database', async () => {
    const a = await newAgreement();
    await expect(publish(a.id, 2)).rejects.toThrow(/next version must be 1/);
    const body = '# Café agreement\n\nNot legal text. ✓';
    const v1 = await publish(a.id, 1, { body, bodySha256: 'f'.repeat(64) });
    expect(v1.bodySha256).toBe(createHash('sha256').update(body, 'utf8').digest('hex'));
    await expect(publish(a.id, 1)).rejects.toThrow(/next version must be 2|unique/i);
    await expect(publish(a.id, 3)).rejects.toThrow(/next version must be 2/);
    await expect(publish(a.id, 2)).resolves.toMatchObject({ version: 2 });
  });

  it('are insert-only, even for the owner role', async () => {
    const a = await newAgreement();
    const v1 = await publish(a.id, 1);
    await expect(
      firmA().firmAgreementVersion.update({ where: { id: v1.id }, data: { title: 'Edited' } }),
    ).rejects.toThrow(/permission denied/);
    await expect(firmA().firmAgreementVersion.delete({ where: { id: v1.id } })).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.firmAgreementVersion.update({ where: { id: v1.id }, data: { title: 'Edited' } }),
      ),
    ).rejects.toThrow(/insert-only/);
  });

  it('check acknowledgments: at most 8, unique keys, every field; firm-wide needs a required one', async () => {
    const a = await newAgreement();
    const ack = (key: string, required = false) => ({ key, label: 'L', text: 'T', required });
    for (const acknowledgments of [
      Array.from({ length: 9 }, (_, i) => ack(`k${i}x`)),
      [ack('same'), ack('same')],
      [{ key: 'Bad Key', label: 'L', text: 'T', required: true }],
      [{ key: 'ok_key', label: '', text: 'T', required: true }],
      [{ key: 'ok_key', label: 'L', text: 'T', required: 'yes' }],
      [{ ...ack('ok_key'), extra: 1 }],
    ]) {
      await expect(publish(a.id, 1, { acknowledgments })).rejects.toThrow(/check constraint/i);
    }
    await expect(publish(a.id, 1, { acknowledgments: [] })).resolves.toMatchObject({ version: 1 });
    await expect(
      firmA().firmAgreementVersion.create({
        data: {
          ...A(),
          agreementId: ids.firmWideA,
          version: (await firmWideVersion()).version + 1,
          title: 'No required',
          bodyMarkdown: 'Text',
          acknowledgments: [ack('optional_only')],
          publishedByUserId: ids.ownerA,
        },
      }),
    ).rejects.toThrow(/needs a required acknowledgment/);
  });

  it('link a PDF only when it is CLEAN, of the same firm, with its own hash', async () => {
    const a = await newAgreement();
    const f = await newFile();
    await expect(publish(a.id, 1, { pdfFileId: f.id, pdfSha256: f.sha256 })).rejects.toThrow(
      /scanned CLEAN/,
    );
    const infected = await newFile();
    await scan(infected.id, 'INFECTED');
    await expect(
      publish(a.id, 1, { pdfFileId: infected.id, pdfSha256: infected.sha256 }),
    ).rejects.toThrow(/scanned CLEAN/);
    await scan(f.id, 'CLEAN');
    await expect(publish(a.id, 1, { pdfFileId: f.id })).rejects.toThrow(/check constraint/i);
    await expect(publish(a.id, 1, { pdfFileId: f.id, pdfSha256: sha('other') })).rejects.toThrow(
      /foreign key/i,
    );
    await expect(publish(a.id, 1, { pdfFileId: f.id, pdfSha256: f.sha256 })).resolves.toMatchObject(
      { pdfSha256: f.sha256 },
    );
  });
});

describe('intake signatures and submit', () => {
  it('a Begin Online submit: sign the firm-wide version on a draft and submit with the same evidence, in one transaction', async () => {
    const draft = await newLeadDraft(await newService());
    const v = await firmWideVersion();
    const data = {
      signerEmail: 'lena@begin.test',
      termsDocumentId: ids.termsA,
      privacyDocumentId: ids.privacyA,
      signedAt: new Date('2000-01-01'),
    };
    await expect(
      signAndSubmit(draft, [v], { data, change: { ip: '198.51.100.1' } }),
    ).rejects.toThrow(/needs the signature/);
    for (const change of [
      { printedName: 'Someone Else' },
      { userAgent: 'Other browser' },
      { userAgent: null },
    ]) {
      await expect(signAndSubmit(draft, [v], { data, change })).rejects.toThrow(
        /needs the signature/,
      );
    }
    const before = Date.now();
    const { sig, submitted } = await signAndSubmit(draft, [v], {
      data,
      change: { submittedAt: new Date('2000-01-01') } as Partial<Evidence>,
    });
    // The database's time, whatever the app sent.
    expect(sig.signedAt.getTime()).toBeGreaterThan(before - 60_000);
    expect(submitted.submittedAt?.getTime()).toBeGreaterThan(before - 60_000);
    expect(submitted.signerName).toBe('Lena Lead');
    // The database hashed the stored answers, not what the app sent.
    expect(sig.answersSha256).toBe(sha('{"fullName": "Lena Lead"}'));

    // Locked after submit; the next version is a new draft that needs its own signature.
    await expect(
      firmA().intakeSubmission.update({
        where: { id: draft.submission.id },
        data: { answers: { fullName: 'Changed' } },
      }),
    ).rejects.toThrow(/locked/);
    await expect(
      firmA().intakeSubmission.update({
        where: { id: draft.submission.id },
        data: { submittedAt: null },
      }),
    ).rejects.toThrow(/locked/);
    await expect(sign(draft, [v])).rejects.toThrow(/only a draft/);
    // A version not yet on the signature (so only the submitted rule can refuse it).
    const late = await newAgreement({
      serviceId: (
        await firmA().intakeForm.findUniqueOrThrow({
          where: { id: draft.intake.formId },
        })
      ).serviceId,
    });
    const lv = await publish(late.id, 1);
    await expect(
      firmA().intakeSignatureAgreement.create({
        data: { ...A(), signatureId: sig.id, agreementVersionId: lv.id, bodySha256: lv.bodySha256 },
      }),
    ).rejects.toThrow(/already submitted/);
    await expect(
      firmA().intakeSubmission.create({ data: { ...A(), intakeId: draft.intake.id, version: 3 } }),
    ).rejects.toThrow(/next version must be 2/);
    const v2 = await firmA().intakeSubmission.create({
      data: { ...A(), intakeId: draft.intake.id, version: 2 },
    });
    await expect(
      submit(v2.id, { printedName: 'Lena Lead', signedAt: new Date(), ip: null, userAgent: null }),
    ).rejects.toThrow(/needs the signature/);
  });

  it('a signature from an earlier transaction cannot be submitted, and signed answers are frozen', async () => {
    const draft = await newLeadDraft(await newService());
    const sig = await sign(draft, [await firmWideVersion()]);
    await expect(submit(draft.submission.id, sig)).rejects.toThrow(/needs the signature/);
    await expect(
      firmA().intakeSubmission.update({
        where: { id: draft.submission.id },
        data: { answers: { fullName: 'Changed after signing' } },
      }),
    ).rejects.toThrow(/signed answers cannot change/);
    // Other unsigned drafts stay editable.
    const other = await newLeadDraft(await newService());
    await expect(
      firmA().intakeSubmission.update({
        where: { id: other.submission.id },
        data: { answers: { fullName: 'Edited draft' } },
      }),
    ).resolves.toMatchObject({ answers: { fullName: 'Edited draft' } });
  });

  it("a submit needs every current agreement of the form's service, not archived ones", async () => {
    const serviceId = await newService();
    const fw = await firmWideVersion();
    const needed = await newAgreement({ serviceId });
    const nv = await publish(needed.id, 1);
    const archived = await newAgreement({ serviceId });
    await publish(archived.id, 1);
    await firmA().firmAgreement.update({
      where: { id: archived.id },
      data: { archivedAt: new Date() },
    });
    // Not yet published: nothing to sign.
    await newAgreement({ serviceId });
    const draft = await newLeadDraft(serviceId);
    await expect(signAndSubmit(draft, [fw])).rejects.toThrow(/service's agreements/);
    await expect(signAndSubmit(draft, [fw, nv])).resolves.toMatchObject({
      submitted: { signerName: 'Lena Lead' },
    });
  });

  it('evidence is insert-only, even for the owner role', async () => {
    const draft = await newLeadDraft();
    const sig = await sign(draft, [await firmWideVersion()]);
    await expect(
      firmA().intakeSignature.update({ where: { id: sig.id }, data: { printedName: 'X' } }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.intakeSignature.update({ where: { id: sig.id }, data: { printedName: 'X' } }),
      ),
    ).rejects.toThrow(/insert-only/);
    await expect(
      runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.intakeSignatureAgreement.deleteMany({ where: { signatureId: sig.id } }),
      ),
    ).rejects.toThrow(/insert-only/);
  });

  it('a submit needs the firm-wide agreement among the signed versions', async () => {
    const service = await newAgreement({ serviceId: ids.bookkeeping });
    const sv = await publish(service.id, 1);
    const draft = await newLeadDraft();
    await expect(signAndSubmit(draft, [sv])).rejects.toThrow(/needs the signature/);
  });

  it('every required acknowledgment is ticked with the exact words', async () => {
    const v = await firmWideVersion();
    const draft = await newLeadDraft();
    await expect(
      sign(draft, [v], { acknowledgments: ticks(v, ['read', 'contact']) }),
    ).rejects.toThrow(/every required acknowledgment/);
    const reworded = ticks(v).map((a) => (a.key === 'read' ? { ...a, text: 'Other words' } : a));
    await expect(sign(draft, [v], { acknowledgments: reworded })).rejects.toThrow(
      /every required acknowledgment/,
    );
    const unticked = ticks(v).map((a) => (a.key === 'read' ? { ...a, checked: false } : a));
    await expect(sign(draft, [v], { acknowledgments: unticked })).rejects.toThrow(
      /every required acknowledgment/,
    );
    // Optional ones may stay unticked.
    await expect(
      sign(draft, [v], { acknowledgments: ticks(v, ['read', 'accurate']) }),
    ).resolves.toMatchObject({ printedName: 'Lena Lead' });
  });

  it('only the current version, with its own hashes, of a service agreement for this service', async () => {
    const draft = await newLeadDraft();
    const v = await firmWideVersion();
    await expect(sign(draft, [{ ...v, bodySha256: sha('tampered') }])).rejects.toThrow(
      /hashes must be/,
    );
    await expect(sign(draft, [{ ...v, pdfSha256: sha('pdf') }])).rejects.toThrow(/hashes must be/);

    const taxOnly = await newAgreement({ serviceId: ids.tax });
    const tv = await publish(taxOnly.id, 1);
    await expect(sign(draft, [v, tv])).rejects.toThrow(/intake's service/);

    const series = await newAgreement({ serviceId: ids.bookkeeping });
    const old = await publish(series.id, 1);
    await publish(series.id, 2);
    await expect(sign(draft, [v, old])).rejects.toThrow(/only the current version/);

    const archived = await newAgreement({ serviceId: ids.bookkeeping });
    const av = await publish(archived.id, 1);
    await firmA().firmAgreement.update({
      where: { id: archived.id },
      data: { archivedAt: new Date() },
    });
    await expect(sign(draft, [v, av])).rejects.toThrow(/only the current version of an unarchived/);

    // The submission must be a draft of the signature's own intake.
    const other = await newLeadDraft();
    await expect(sign({ ...draft, submission: other.submission }, [v])).rejects.toThrow(
      /only a draft version of this intake/,
    );
  });

  it('a lead signs only its own intake; a portal login only for its engagement client', async () => {
    const draft = await newLeadDraft();
    const other = await newLeadDraft();
    const v = await firmWideVersion();
    await expect(sign({ ...draft, lead: other.lead }, [v])).rejects.toThrow(/intake's lead/);
    await expect(
      sign(draft, [v], { leadId: undefined, clientAccountId: ids.clientAccountA }),
    ).rejects.toThrow(/engagement's client/);
    await expect(sign(draft, [v], { leadId: undefined })).rejects.toThrow(/check constraint/i);

    const portalDraft = async () => {
      const intake = await firmA().intake.create({
        data: { ...A(), formId: ids.taxForm, engagementId: ids.engagement },
      });
      const submission = await firmA().intakeSubmission.create({
        data: { ...A(), intakeId: intake.id, version: 1 },
      });
      return { intake, submission };
    };
    const portal = await portalDraft();
    const as = (clientAccountId: string, actorUserId?: string) =>
      sign(portal, [v], { clientAccountId }, actorUserId);
    // Another client's login, a login signing for someone else, and no signed-in user.
    await expect(as(ids.otherClientAccountA, ids.clientUserA2)).rejects.toThrow(
      /engagement's client/,
    );
    await expect(as(ids.clientAccountA, ids.clientUserA2)).rejects.toThrow(/engagement's client/);
    await expect(as(ids.clientAccountA)).rejects.toThrow(/engagement's client/);
    // The engagement's own login, signed in.
    const tax = await firmA().firmAgreement.findMany({
      where: { serviceId: ids.tax, archivedAt: null },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    const taxVersions = tax.flatMap((a) => a.versions);
    await expect(
      signAndSubmit(portal, [v, ...taxVersions], {
        data: { clientAccountId: ids.clientAccountA },
        actorUserId: ids.clientUserA,
      }),
    ).resolves.toMatchObject({ submitted: { signerIp: '203.0.113.7' } });

    // A disabled login cannot sign.
    await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
      tx.clientAccount.update({ where: { id: ids.clientAccountA }, data: { status: 'DISABLED' } }),
    );
    try {
      await expect(
        sign(await portalDraft(), [v], { clientAccountId: ids.clientAccountA }, ids.clientUserA),
      ).rejects.toThrow(/engagement's client/);
    } finally {
      await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.clientAccount.update({ where: { id: ids.clientAccountA }, data: { status: 'ACTIVE' } }),
      );
    }
  });

  it('checks names, typed method, email, Terms and Privacy kinds and hashes', async () => {
    const draft = await newLeadDraft();
    const v = await firmWideVersion();
    for (const data of [
      { printedName: '  ' },
      { signatureText: 'x'.repeat(201) },
      { signatureMethod: 'DRAWN' },
      { signerEmail: 'Mixed@Begin.test' },
      { termsDocumentId: ids.termsA },
      { userAgent: 'u'.repeat(513) },
      { evidenceSha256: 'not-a-hash' },
      { printedName: 'Lena\u200bLead', signatureText: 'Lena\u200bLead' },
      { printedName: 'Lena\u202eLead', signatureText: 'Lena\u202eLead' },
      { signerTitle: 'Owner\u0007' },
      { signatureText: 'Someone Else' },
    ]) {
      await expect(sign(draft, [v], data)).rejects.toThrow(/check constraint/i);
    }
    await expect(
      sign(draft, [v], { termsDocumentId: ids.privacyA, privacyDocumentId: ids.termsA }),
    ).rejects.toThrow(/Terms and Privacy/);
    // The typed name may differ in case and spacing only.
    await expect(
      sign(draft, [v], { printedName: 'Lena  Lead ', signatureText: 'lena lead' }),
    ).resolves.toMatchObject({ signatureText: 'lena lead' });
  });
});

describe('isolation', () => {
  it('every reference is a composite foreign key within the same firm', async () => {
    const rows = await runInScope(
      owner,
      { kind: 'platform' },
      (tx) =>
        tx.$queryRaw<{ def: string }[]>`
        SELECT conrelid::regclass::text || ': ' || pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE contype = 'f' AND conrelid::regclass::text IN ('firm_agreements',
          'firm_agreement_files', 'firm_agreement_versions', 'intake_signatures',
          'intake_signature_agreements')`,
    );
    const fk = (table: string, columns: string, target: string) =>
      `${table}: FOREIGN KEY (business_id, ${columns}) REFERENCES ${target} ON UPDATE CASCADE ON DELETE RESTRICT`;
    // Sorted here: the database's collation orders underscores differently from JavaScript.
    expect(rows.map((r) => r.def).sort()).toEqual(
      [
        fk('firm_agreement_files', 'uploaded_by_user_id', 'memberships(business_id, user_id)'),
        fk('firm_agreement_versions', 'agreement_id', 'firm_agreements(business_id, id)'),
        fk(
          'firm_agreement_versions',
          'pdf_file_id, pdf_sha256',
          'firm_agreement_files(business_id, id, sha256)',
        ),
        fk('firm_agreement_versions', 'published_by_user_id', 'memberships(business_id, user_id)'),
        fk('firm_agreements', 'created_by_user_id', 'memberships(business_id, user_id)'),
        fk('firm_agreements', 'service_id', 'services(business_id, id)'),
        fk(
          'intake_signature_agreements',
          'agreement_version_id',
          'firm_agreement_versions(business_id, id)',
        ),
        fk('intake_signature_agreements', 'signature_id', 'intake_signatures(business_id, id)'),
        fk('intake_signatures', 'client_account_id', 'client_accounts(business_id, id)'),
        fk('intake_signatures', 'intake_id', 'intakes(business_id, id)'),
        fk('intake_signatures', 'lead_id', 'leads(business_id, id)'),
        fk('intake_signatures', 'privacy_document_id', 'firm_legal_documents(business_id, id)'),
        fk('intake_signatures', 'submission_id', 'intake_submissions(business_id, id)'),
        fk('intake_signatures', 'terms_document_id', 'firm_legal_documents(business_id, id)'),
      ].sort(),
    );
  });

  it("firm B sees none of firm A's agreements, files, versions or evidence", async () => {
    const draft = await newLeadDraft();
    await sign(draft, [await firmWideVersion()]);
    const counts = await Promise.all([
      firmB().firmAgreement.count({ where: { businessId: ids.firmA } }),
      firmB().firmAgreementFile.count({ where: { businessId: ids.firmA } }),
      firmB().firmAgreementVersion.count({ where: { businessId: ids.firmA } }),
      firmB().intakeSignature.count({ where: { businessId: ids.firmA } }),
      firmB().intakeSignatureAgreement.count({ where: { businessId: ids.firmA } }),
    ]);
    expect(counts).toEqual([0, 0, 0, 0, 0]);
    expect(await firmA().firmAgreement.count()).toBeGreaterThan(0);
  });

  it("firm B cannot write into firm A or point at firm A's rows", async () => {
    await expect(
      firmB().firmAgreement.create({
        data: {
          businessId: ids.firmA,
          scope: 'SERVICE',
          serviceId: ids.tax,
          createdByUserId: ids.ownerA,
        },
      }),
    ).rejects.toThrow(/row-level security/i);
    // A firm-wide version of B pointing at A's CLEAN file.
    const f = await newFile();
    await scan(f.id, 'CLEAN');
    await expect(
      firmB().firmAgreementVersion.create({
        data: {
          businessId: ids.firmB,
          agreementId: ids.firmWideB,
          version: 1,
          title: 'B',
          bodyMarkdown: 'B text',
          acknowledgments: ACKS,
          pdfFileId: f.id,
          pdfSha256: f.sha256,
          publishedByUserId: ids.ownerB,
        },
      }),
    ).rejects.toThrow(/scanned CLEAN|foreign key/i);
    // B's evidence row pointing at A's version.
    const v = await firmWideVersion();
    await expect(
      firmB().intakeSignatureAgreement.create({
        data: {
          businessId: ids.firmB,
          signatureId: randomUUID(),
          agreementVersionId: v.id,
          bodySha256: v.bodySha256,
        },
      }),
    ).rejects.toThrow(/foreign key/i);
    // Firm B writing rows that say they are firm A's.
    await expect(
      firmB().firmAgreementFile.create({
        data: {
          businessId: ids.firmA,
          fileName: 'a.pdf',
          sizeBytes: 1,
          sha256: sha('b-into-a'),
          s3Key: `tenant/${ids.firmA}/agreements/${randomUUID()}`,
          uploadedByUserId: ids.ownerA,
        },
      }),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      firmB().firmAgreementVersion.create({
        data: {
          businessId: ids.firmA,
          agreementId: ids.firmWideA,
          version: v.version + 1,
          title: 'B into A',
          bodyMarkdown: 'B text',
          acknowledgments: ACKS,
          publishedByUserId: ids.ownerA,
        },
      }),
    ).rejects.toThrow(/row-level security/i);
    const aDraft = await newLeadDraft();
    await expect(firmB().intakeSignature.create({ data: signature(aDraft) })).rejects.toThrow(
      /row-level security/i,
    );
    // Firm B's own rows naming firm A's owner: only the membership foreign key refuses them.
    await expect(
      firmB().firmAgreement.create({
        data: {
          businessId: ids.firmB,
          scope: 'SERVICE',
          serviceId: ids.serviceB,
          createdByUserId: ids.ownerA,
        },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      firmB().firmAgreementFile.create({
        data: {
          businessId: ids.firmB,
          fileName: 'b.pdf',
          sizeBytes: 1,
          sha256: sha('b-by-a'),
          s3Key: `tenant/${ids.firmB}/agreements/${randomUUID()}`,
          uploadedByUserId: ids.ownerA,
        },
      }),
    ).rejects.toThrow(/foreign key/i);
    // A's signature naming firm B's Terms.
    const draft = await newLeadDraft();
    await expect(
      sign(draft, [v], { termsDocumentId: ids.termsB, privacyDocumentId: ids.privacyA }),
    ).rejects.toThrow(/firm's Terms and Privacy|foreign key/i);
  });
});
