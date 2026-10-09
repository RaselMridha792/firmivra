import type { Prisma, TxClient } from '@firmivra/db';
import {
  INTAKE_FORMS,
  IntakeFormDefinition,
  IntakeFormKey,
  type ServiceKind,
} from '@firmivra/types';

/** A published form version as the API serves it: key and version from the row's columns. */
export interface PublishedForm {
  id: string;
  version: number;
  definition: IntakeFormDefinition;
}

/** The stored definition with the row's kind and version, as contract A says the API returns it. */
export function readDefinition(row: { version: number; definition: unknown }, kind: ServiceKind) {
  const parsed = IntakeFormDefinition.parse(row.definition);
  return { ...parsed, key: IntakeFormKey.parse(kind), version: row.version };
}

/**
 * The service's newest PUBLISHED form version. A firm starts with Firmivra's built-in form for the
 * service's kind: when the service has no version yet, version 1 is published from it (once: the
 * unique version makes a second writer fail, and the caller's transaction retries the read).
 * Null for a service with no built-in form (OTHER).
 */
export async function publishedForm(
  tx: TxClient,
  businessId: string,
  service: { id: string; kind: ServiceKind },
): Promise<PublishedForm | null> {
  const select = { id: true, version: true, definition: true } satisfies Prisma.IntakeFormSelect;
  const found = await tx.intakeForm.findFirst({
    where: { businessId, serviceId: service.id, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
    select,
  });
  if (found) return { ...found, definition: readDefinition(found, service.kind) };
  if (service.kind === 'OTHER') return null;
  const builtIn = INTAKE_FORMS[service.kind];
  if (!builtIn) return null;
  const any = await tx.intakeForm.findFirst({
    where: { businessId, serviceId: service.id },
    select: { id: true },
  });
  // A firm that has its own versions (drafts or retired) publishes them itself.
  if (any) return null;
  const created = await tx.intakeForm.create({
    data: {
      businessId,
      serviceId: service.id,
      version: 1,
      title: builtIn.title,
      definition: builtIn as unknown as Prisma.InputJsonValue,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
    select,
  });
  return { ...created, definition: readDefinition(created, service.kind) };
}
