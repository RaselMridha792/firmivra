import { ConflictException } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';

/** Contract B's code and words for a firm with nothing to sign yet. */
export const NO_INTAKE_AGREEMENT = 'NO_INTAKE_AGREEMENT';

const noAgreement = () =>
  new ConflictException({
    code: NO_INTAKE_AGREEMENT,
    message: "This form can't be signed right now. Please contact the firm.",
  });

/**
 * Before signing a submit (portal intake or Begin Online): the firm must have a published
 * firm-wide intake agreement, that is an unarchived `firm_agreements` row with scope ALL_INTAKES
 * and at least one `firm_agreement_versions` row (r0_intake_agreements). Without one the database
 * would refuse the submit; this answers 409 NO_INTAKE_AGREEMENT first. Reads in the caller's
 * tenant-scoped transaction and writes nothing.
 */
export async function requireFirmWideAgreement(tx: TxClient, businessId: string): Promise<void> {
  const agreement = await tx.firmAgreement.findFirst({
    where: { businessId, scope: 'ALL_INTAKES', archivedAt: null, versions: { some: {} } },
    select: { id: true },
  });
  if (!agreement) throw noAgreement();
}
