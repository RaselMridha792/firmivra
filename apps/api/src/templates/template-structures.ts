import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, type TxClient } from '@firmivra/db';
import {
  BookkeepingStructure,
  type LinkedModuleTemplate,
  type LinkedTemplateKind,
  type MessageTemplateKind,
  type TemplateStructure,
  type TemplateStructureOptions,
  TaxWorkflowStructure,
} from '@firmivra/types';
import { templateErrors } from './templates.common.js';

// TP-F08 (R1's r1_template_structures): a structured kind keeps a real structure, not only text.
// TASK, DOCUMENT_REQUEST and INTAKE_ORGANIZER stand for their module's own template (a link, one
// per module template in the firm); TAX_WORKFLOW and BOOKKEEPING keep theirs in `structure`, a JSON
// object of the shape packages/types gives. The database's check keeps each on its own kind.

const LINKS = {
  TASK: 'taskTemplateId',
  DOCUMENT_REQUEST: 'documentRequestTemplateId',
  INTAKE_ORGANIZER: 'intakeTemplateId',
} as const satisfies Record<LinkedTemplateKind, string>;
type LinkField = (typeof LINKS)[LinkedTemplateKind];
const FIELDS = Object.values(LINKS);

const SHAPES: Partial<
  Record<MessageTemplateKind, typeof TaxWorkflowStructure | typeof BookkeepingStructure>
> = {
  TAX_WORKFLOW: TaxWorkflowStructure,
  BOOKKEEPING: BookkeepingStructure,
};

/** What a save writes to the structure columns (only the ones sent). */
export interface StructureData {
  taskTemplateId?: string | null;
  documentRequestTemplateId?: string | null;
  intakeTemplateId?: string | null;
  structure?: Prisma.InputJsonValue | typeof Prisma.DbNull;
}

export interface StructureInput {
  taskTemplateId?: string | null | undefined;
  documentRequestTemplateId?: string | null | undefined;
  intakeTemplateId?: string | null | undefined;
  structure?: TemplateStructure | null | undefined;
}

const inUse = () =>
  new ConflictException({
    code: 'STRUCTURE_IN_USE',
    message: 'Another template already stands for this one',
  });
const missing = () =>
  new NotFoundException({ code: 'NOT_FOUND', message: 'That template was not found' });

/**
 * The structure columns a save writes: a link only on its own kind (400), to one of the firm's
 * module templates (404) that no other template stands for (409 STRUCTURE_IN_USE); a structure
 * only on TAX_WORKFLOW and BOOKKEEPING, of their shape (400). Fields not sent stay as they are.
 */
export async function structureData(
  tx: TxClient,
  businessId: string,
  kind: MessageTemplateKind,
  body: StructureInput,
  templateId?: string,
): Promise<StructureData> {
  const data: StructureData = {};
  for (const field of FIELDS) {
    const id = body[field];
    if (id === undefined) continue;
    if (id !== null && LINKS[kind as LinkedTemplateKind] !== field) {
      throw templateErrors.invalid(field, 'Only its own kind of template has this');
    }
    if (id !== null) {
      if (!(await moduleTemplateExists(tx, businessId, field, id))) throw missing();
      const other = await tx.messageTemplate.findFirst({
        where: { businessId, [field]: id, ...(templateId ? { id: { not: templateId } } : {}) },
        select: { id: true },
      });
      if (other) throw inUse();
    }
    data[field] = id;
  }
  if (body.structure !== undefined) {
    const shape = SHAPES[kind];
    if (body.structure !== null) {
      if (!shape)
        throw templateErrors.invalid('structure', 'Only its own kind of template has this');
      const parsed = shape.safeParse(body.structure);
      if (!parsed.success) {
        throw templateErrors.invalid('structure', parsed.error.issues[0]?.message ?? 'Check it');
      }
      data.structure = parsed.data as Prisma.InputJsonValue;
    } else data.structure = Prisma.DbNull;
  }
  return data;
}

async function moduleTemplateExists(
  tx: TxClient,
  businessId: string,
  field: LinkField,
  id: string,
): Promise<boolean> {
  if (field === 'taskTemplateId') {
    return (await tx.taskTemplate.count({ where: { businessId, id } })) > 0;
  }
  if (field === 'documentRequestTemplateId') {
    return (
      (await tx.documentRequestTemplate.count({ where: { businessId, id, archivedAt: null } })) > 0
    );
  }
  return (await tx.intakeTemplate.count({ where: { businessId, id, archivedAt: null } })) > 0;
}

/** A stored structure, read back by its kind's shape (null when none or not of the shape). */
export function structureOf(kind: MessageTemplateKind, value: unknown): TemplateStructure | null {
  const shape = SHAPES[kind];
  if (!shape || value === null || value === undefined) return null;
  const parsed = shape.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Labels of a task template's checklist JSON (its items carry a `label`). */
const labels = (checklist: Prisma.JsonValue): string[] =>
  Array.isArray(checklist)
    ? checklist.flatMap((c) =>
        c && typeof c === 'object' && !Array.isArray(c) && typeof c.label === 'string'
          ? [c.label]
          : [],
      )
    : [];

/** The module templates of one kind in the firm, with what they hold and who stands for them. */
export async function linkedTemplates(
  tx: TxClient,
  businessId: string,
  kind: LinkedTemplateKind,
  ids?: string[],
): Promise<TemplateStructureOptions['items']> {
  const field = LINKS[kind];
  const byId = ids ? { id: { in: ids } } : {};
  const users = new Map(
    (
      await tx.messageTemplate.findMany({
        where: { businessId, NOT: { [field]: null } },
        select: {
          id: true,
          taskTemplateId: true,
          documentRequestTemplateId: true,
          intakeTemplateId: true,
        },
      })
    ).map((t) => [t[field], t.id] as const),
  );
  const used = (id: string): string | null => users.get(id) ?? null;
  if (kind === 'TASK') {
    const rows = await tx.taskTemplate.findMany({
      where: { businessId, ...byId },
      orderBy: { name: 'asc' },
      take: 200,
      select: { id: true, name: true, checklist: true },
    });
    return rows.map((r) => ({
      kind,
      id: r.id,
      name: r.name,
      steps: labels(r.checklist),
      usedByTemplateId: used(r.id),
    }));
  }
  if (kind === 'DOCUMENT_REQUEST') {
    const rows = await tx.documentRequestTemplate.findMany({
      where: { businessId, ...(ids ? byId : { archivedAt: null }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: 200,
      select: {
        id: true,
        name: true,
        items: { orderBy: { sortOrder: 'asc' }, select: { title: true, required: true } },
      },
    });
    return rows.map((r) => ({
      kind,
      id: r.id,
      name: r.name,
      steps: r.items.map((i) => (i.required ? i.title : `${i.title} (optional)`)),
      usedByTemplateId: used(r.id),
    }));
  }
  const rows = await tx.intakeTemplate.findMany({
    where: { businessId, ...(ids ? byId : { archivedAt: null }) },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: {
      id: true,
      service: { select: { name: true } },
      forms: { orderBy: { version: 'desc' }, take: 1, select: { title: true } },
    },
  });
  return rows.map((r) => ({
    kind,
    id: r.id,
    name: `${r.service.name} intake`,
    steps: r.forms.map((f) => f.title),
    usedByTemplateId: used(r.id),
  }));
}

/** The module template a structured template stands for, for its detail (null otherwise). */
export async function linkedOf(
  tx: TxClient,
  businessId: string,
  t: {
    kind: MessageTemplateKind;
    taskTemplateId: string | null;
    documentRequestTemplateId: string | null;
    intakeTemplateId: string | null;
  },
): Promise<LinkedModuleTemplate | null> {
  const kind = t.kind as LinkedTemplateKind;
  const id = LINKS[kind] ? t[LINKS[kind]] : null;
  if (!id) return null;
  const [row] = await linkedTemplates(tx, businessId, kind, [id]);
  if (!row) return null;
  const { usedByTemplateId: _used, ...linked } = row;
  return linked;
}
