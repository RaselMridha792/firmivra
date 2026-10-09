// Test helper: a Begin Online version submitted the way the real submit leaves it. The database
// takes submitted_at only with this version's signature from the same transaction, covering a
// firm-wide agreement, so the helper publishes one for the firm when it has none, signs as the
// lead, submits the version and marks the intake and the lead SUBMITTED with the version's time.
// Synthetic text only.
import { createHash, randomUUID } from 'node:crypto';
import type { TxClient } from '@firmivra/db';

const ACKS = [
  { key: 'read', label: 'I read it', text: 'Synthetic acknowledgment.', required: true },
];

/** The firm's current firm-wide agreement version, published as `ownerId` if there is none. */
async function firmWideVersion(tx: TxClient, businessId: string, ownerId: string) {
  const where = { businessId, agreement: { scope: 'ALL_INTAKES' as const, archivedAt: null } };
  const found = await tx.firmAgreementVersion.findFirst({ where, orderBy: { version: 'desc' } });
  if (found) return found;
  const agreement = await tx.firmAgreement.create({
    data: { businessId, scope: 'ALL_INTAKES', createdByUserId: ownerId },
  });
  return tx.firmAgreementVersion.create({
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
}

/**
 * Signs and submits the lead's draft version `submissionId` as the visitor, then marks the intake
 * and the lead SUBMITTED, the lead with the version's submitted time. Returns that time.
 */
export async function submitLeadVersion(
  tx: TxClient,
  ids: {
    businessId: string;
    ownerId: string;
    leadId: string;
    intakeId: string;
    submissionId: string;
  },
): Promise<Date> {
  const { businessId, leadId, intakeId, submissionId } = ids;
  const version = await firmWideVersion(tx, businessId, ids.ownerId);
  const sig = await tx.intakeSignature.create({
    data: {
      businessId,
      submissionId,
      intakeId,
      leadId,
      printedName: 'Fake Visitor',
      signatureText: 'Fake Visitor',
      acknowledgments: ACKS.map((a) => ({ agreementVersionId: version.id, ...a, checked: true })),
      answersSha256: '0'.repeat(64), // replaced by the database
      evidenceSha256: createHash('sha256').update(randomUUID()).digest('hex'),
      agreements: {
        create: {
          agreementVersionId: version.id,
          bodySha256: version.bodySha256,
          pdfSha256: version.pdfSha256,
        },
      },
    },
  });
  const { submittedAt } = await tx.intakeSubmission.update({
    where: { id: submissionId },
    data: {
      submittedAt: new Date(), // the database sets its own time
      signerName: sig.printedName,
      signedAt: sig.signedAt,
      signerIp: sig.ip,
      signerUserAgent: sig.userAgent,
    },
    select: { submittedAt: true },
  });
  await tx.intake.update({ where: { id: intakeId }, data: { status: 'SUBMITTED' } });
  await tx.lead.update({ where: { id: leadId }, data: { status: 'SUBMITTED', submittedAt } });
  return submittedAt!;
}
