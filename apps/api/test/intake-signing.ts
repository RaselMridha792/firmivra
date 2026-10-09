// Test helpers around intake signing: a published firm-wide agreement for a firm, the contract B
// signature for it, and a stand-in signer (INTAKE_SIGNING's interface) that writes the
// intake_signatures row the database needs without R14's checks. The e2e tests sign with R14's
// real IntakeSignaturesService. Synthetic text only.
import { createHash, randomUUID } from 'node:crypto';
import type { TxClient } from '@firmivra/db';
import type { IntakeSigner } from '../src/intake/intake-signing.js';

const ACKS = [
  { key: 'read', label: 'I read it', text: 'Synthetic acknowledgment.', required: true },
];

/** Publishes a firm-wide intake agreement (v1) in the firm, as `ownerId` (an active member). */
export async function publishFirmWideAgreement(
  tx: TxClient,
  businessId: string,
  ownerId: string,
): Promise<string> {
  const agreement = await tx.firmAgreement.create({
    data: { businessId, scope: 'ALL_INTAKES', createdByUserId: ownerId },
  });
  await tx.firmAgreementVersion.create({
    data: {
      businessId,
      agreementId: agreement.id,
      version: 1,
      title: 'Client intake agreement (sample)',
      bodyMarkdown: '# Sample agreement\n\nNot legal text.',
      acknowledgments: ACKS,
      publishedByUserId: ownerId,
    },
  });
  return agreement.id;
}

/**
 * Stand-in signer for a Begin Online version, as its lead: the current firm-wide version, every
 * acknowledgment ticked, the names and source the submit gave, none of R14's checks. Answers the
 * stored evidence.
 */
export const TEST_LEAD_SIGNING: IntakeSigner = {
  async sign(tx, input) {
    const { signature } = input;
    const ids = input;
    const intake = await tx.intake.findUniqueOrThrow({
      where: { id: ids.intakeId },
      select: { leadId: true },
    });
    const version = await tx.firmAgreementVersion.findFirstOrThrow({
      where: { businessId: ids.businessId, agreement: { scope: 'ALL_INTAKES', archivedAt: null } },
      orderBy: { version: 'desc' },
    });
    const acks = version.acknowledgments as typeof ACKS;
    const sig = await tx.intakeSignature.create({
      data: {
        businessId: ids.businessId,
        submissionId: ids.submissionId,
        intakeId: ids.intakeId,
        leadId: intake.leadId,
        printedName: signature.signer.printedName,
        signatureText: signature.signer.typedSignature,
        acknowledgments: acks.map((a) => ({ agreementVersionId: version.id, ...a, checked: true })),
        answersSha256: '0'.repeat(64), // replaced by the database
        evidenceSha256: createHash('sha256').update(randomUUID()).digest('hex'),
        ip: input.ip,
        userAgent: input.userAgent,
        agreements: {
          create: {
            agreementVersionId: version.id,
            bodySha256: version.bodySha256,
            pdfSha256: version.pdfSha256,
          },
        },
      },
    });
    return { name: sig.printedName, signedAt: sig.signedAt, ip: sig.ip, userAgent: sig.userAgent };
  },
};

/** The firm's current firm-wide version: what a contract B signature names. */
export async function firmWideVersion(tx: TxClient, businessId: string) {
  return tx.firmAgreementVersion.findFirstOrThrow({
    where: { businessId, agreement: { scope: 'ALL_INTAKES', archivedAt: null } },
    orderBy: { version: 'desc' },
    select: { agreementId: true, version: true, bodySha256: true },
  });
}

/**
 * Contract B's `signature` for a firm-wide version: every acknowledgment ticked, the typed
 * signature `typed` (the printed name by default).
 */
export function signatureFor(
  v: { agreementId: string; version: number; bodySha256: string },
  printedName: string,
  typed = printedName,
) {
  return {
    agreements: [{ agreementId: v.agreementId, version: v.version, bodySha256: v.bodySha256 }],
    acknowledgments: ACKS.map((a) => ({ agreementId: v.agreementId, key: a.key })),
    signer: { printedName, method: 'TYPED' as const, typedSignature: typed },
  };
}
