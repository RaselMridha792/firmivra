// Test stand-ins around intake signing until R14's sign() is on main: a published firm-wide
// agreement for a firm, and a signer that writes the intake_signatures row the database needs
// for a submit (the placeholder writes none). Synthetic text only.
import { createHash, randomUUID } from 'node:crypto';
import type { TxClient } from '@firmivra/db';
import type { IntakeSigner } from '../src/begin-online/signing.js';

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
 * Signs a Begin Online version as its lead: the current firm-wide version, every acknowledgment
 * ticked, the name and source the request gave. Answers the stored evidence.
 */
export const TEST_LEAD_SIGNING: IntakeSigner = {
  async sign(tx, ids, signature) {
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
        printedName: signature.printedName,
        signatureText: signature.typedSignature,
        acknowledgments: acks.map((a) => ({ agreementVersionId: version.id, ...a, checked: true })),
        answersSha256: '0'.repeat(64), // replaced by the database
        evidenceSha256: createHash('sha256').update(randomUUID()).digest('hex'),
        ip: signature.ip,
        userAgent: signature.userAgent,
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
