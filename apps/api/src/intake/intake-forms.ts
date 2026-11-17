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
  // Intake Review 2 23-h: with Allow file uploads off, the client sees no upload question and
  // none is required (the builder's Preview shows the same).
  const shown = storedSettings(row.definition).allowFileUploads === false ? withoutUploads(parsed) : parsed;
  return { ...shown, key: IntakeFormKey.parse(kind), version: row.version };
}

/** The Form Settings a version keeps beside its definition (`formSettings`, the engine ignores it). */
export function storedSettings(definition: unknown): {
  allowFileUploads?: boolean;
  showProgressBar?: boolean;
} {
  const s = (definition as { formSettings?: Record<string, unknown> } | null)?.formSettings ?? {};
  return {
    ...(typeof s['allowFileUploads'] === 'boolean' ? { allowFileUploads: s['allowFileUploads'] } : {}),
    ...(typeof s['showProgressBar'] === 'boolean' ? { showProgressBar: s['showProgressBar'] } : {}),
  };
}

/** 23-h: the client's progress bar (the stepper) unless the form turned it off. */
export const showsProgressBar = (definition: unknown) =>
  storedSettings(definition).showProgressBar !== false;

/**
 * The definition without its upload questions: a section left with none goes, and a step left
 * with no section (never the review step).
 */
function withoutUploads(d: IntakeFormDefinition): IntakeFormDefinition {
  const steps = d.steps
    .map((step) => ({
      ...step,
      sections: step.sections
        .map((section) => ({
          ...section,
          // A group never holds an upload, so only the section's own fields go.
          fields: section.fields.filter((f) => f.type !== 'upload'),
        }))
        .filter((section) => section.fields.length > 0),
    }))
    .filter((step) => step.review || step.sections.length > 0);
  return { ...d, steps };
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
