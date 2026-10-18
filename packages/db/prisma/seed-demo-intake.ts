// Demo seed, stage 3 (R0, PART 2): what Begin Online and the portal Intake tab need. A published
// intake form per service and the firm's intake agreement (v1), Firm Sign and calculators switched
// on, and portal intakes for a few clients (sent, in progress, submitted with a signature).
// `submitSigned` is the one way a demo submission is signed and submitted, shared with the leads
// module, mirroring the LVP seed: a draft, the signature evidence against the firm's agreement
// version, then the submit that copies the signature's name, time, IP and browser.
import { createHash } from 'node:crypto';
import { runInScope, type createPrismaClient, type TxClient } from '../src/client.js';
import { SAMPLE_AGREEMENT, SEED_SERVICES } from './seed-data.js';
import { demoId, SEED_DEMO_USERS } from './seed-demo-data.js';
import { demoDay, demoEngagementId } from './seed-demo-engagements.js';
import type { DemoOrgResult } from './seed-demo-org.js';
import { seedFirmAgreement, seedIntakeForms } from './seed-helpers.js';

type Prisma = ReturnType<typeof createPrismaClient>;

export const DEMO_AGREEMENT_IDS = {
  agreement: demoId('agreement'),
  file: demoId('agreement-file'),
  version: demoId('agreement-version'),
} as const;

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Creates the submission once (a submitted version is locked), signs it against the firm's v1
 * agreement and submits it, in the caller's transaction. Returns the signing time.
 */
export async function submitSigned(
  tx: TxClient,
  businessId: string,
  data: {
    key: string;
    intakeId: string;
    /** Exactly one: the Begin Online lead, or the portal login of the engagement's client. */
    leadId?: string;
    clientAccountId?: string;
    answers: Record<string, string>;
    name: string;
    email: string;
  },
): Promise<Date> {
  const submissionId = demoId(`intake-submission:${data.key}`);
  const existing = await tx.intakeSubmission.findUnique({ where: { id: submissionId } });
  if (existing?.signedAt) return existing.signedAt;
  await tx.intakeSubmission.create({
    data: {
      id: submissionId,
      businessId,
      intakeId: data.intakeId,
      version: 1,
      answers: data.answers,
    },
  });
  const version = await tx.firmAgreementVersion.findUniqueOrThrow({
    where: { id: DEMO_AGREEMENT_IDS.version },
  });
  const signatureId = demoId(`intake-signature:${data.key}`);
  const signature = await tx.intakeSignature.create({
    data: {
      id: signatureId,
      businessId,
      submissionId,
      intakeId: data.intakeId,
      leadId: data.leadId ?? null,
      clientAccountId: data.clientAccountId ?? null,
      printedName: data.name,
      signatureText: data.name,
      signerEmail: data.email,
      acknowledgments: SAMPLE_AGREEMENT.acknowledgments.map((a) => ({
        agreementVersionId: version.id,
        ...a,
        checked: true,
      })),
      // The database replaces this with the hash of the stored answers.
      answersSha256: sha(data.answers),
      evidenceSha256: sha({ demo: signatureId }),
      ip: '198.51.100.24',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Safari/605.1.15',
      agreements: {
        create: {
          agreementVersionId: version.id,
          bodySha256: version.bodySha256,
          pdfSha256: version.pdfSha256,
        },
      },
    },
  });
  await tx.intakeSubmission.update({
    where: { id: submissionId },
    data: {
      submittedAt: signature.signedAt,
      signerName: signature.printedName,
      signedAt: signature.signedAt,
      signerIp: signature.ip,
      signerUserAgent: signature.userAgent,
    },
  });
  return signature.signedAt;
}

/** Each service's intake form id, by service name (filled by seedDemoIntake). */
export type FormLookup = (serviceName: string) => string;

export async function seedDemoIntake(prisma: Prisma, org: DemoOrgResult): Promise<FormLookup> {
  const { businessId } = org;
  const owner = SEED_DEMO_USERS.owner.id;

  const form = await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
    const form = await seedIntakeForms(
      tx,
      businessId,
      org.serviceIds,
      SEED_SERVICES.lvp.map((s) => s.name),
      { realForms: true },
    );
    await seedFirmAgreement(tx, businessId, owner, DEMO_AGREEMENT_IDS);

    // Firm Sign and calculators on. Each switch writes an audit row, so switch only what is off.
    const settings = await tx.businessSettings.findUniqueOrThrow({ where: { businessId } });
    for (const module of ['esign', 'calculators']) {
      if (settings.enabledModules.includes(module)) continue;
      await tx.$queryRaw`SELECT app_set_business_module(${businessId}::uuid, ${module}, true, 'Demo firm')`;
    }

    // Portal intakes on this year's returns: sent, in progress (part answered), submitted.
    // A submitted portal intake is signed by the client's own login: only the portal client has one.
    const intakes: {
      key: string;
      slot: 'tax2025' | 'planning';
      service: string;
      status: 'IN_PROGRESS' | 'SENT' | 'SUBMITTED';
      answers?: Record<string, string>;
    }[] = [
      {
        key: '01',
        slot: 'tax2025',
        service: 'Annual Tax',
        status: 'IN_PROGRESS',
        answers: { firstName: 'Harper', lastName: 'Coleman' },
      },
      {
        key: '01',
        slot: 'planning',
        service: 'Tax Planning',
        status: 'SUBMITTED',
        answers: { fullName: 'Harper Coleman' },
      },
      { key: '06', slot: 'tax2025', service: 'Annual Tax', status: 'SENT' },
      { key: '17', slot: 'tax2025', service: 'Annual Tax', status: 'SENT' },
    ];
    for (const i of intakes) {
      const id = demoId(`intake:${i.key}:${i.slot}`);
      const fresh = !(await tx.intake.findUnique({ where: { id } }));
      if (fresh) {
        await tx.intake.create({
          data: {
            id,
            businessId,
            formId: form(i.service),
            engagementId: demoEngagementId(i.key, i.slot),
            status: i.status === 'SUBMITTED' ? 'IN_PROGRESS' : i.status,
            dueOn: demoDay(21),
            createdByUserId: SEED_DEMO_USERS.clientSupport.id,
          },
        });
      }
      if (i.status === 'IN_PROGRESS' && fresh) {
        await tx.intakeSubmission.create({
          data: {
            id: demoId(`intake-submission:portal:${i.key}:${i.slot}`),
            businessId,
            intakeId: id,
            version: 1,
            answers: i.answers!,
          },
        });
      }
    }
    return form;
  });

  // The portal client signs and submits her own intake: the database takes the signature only
  // from the signed-in, active login of the engagement's client, so this runs as her.
  const harper = demoId('user:client:01');
  await runInScope(prisma, { kind: 'business', businessId, actorUserId: harper }, async (tx) => {
    const login = await tx.clientAccount.findUniqueOrThrow({ where: { userId: harper } });
    const id = demoId('intake:01:planning');
    await submitSigned(tx, businessId, {
      key: 'portal:01:planning',
      intakeId: id,
      clientAccountId: login.id,
      answers: { fullName: 'Harper Coleman' },
      name: 'Harper Coleman',
      email: login.email,
    });
    await tx.intake.updateMany({
      where: { id, status: 'IN_PROGRESS' },
      data: { status: 'SUBMITTED' },
    });
  });
  return form;
}
