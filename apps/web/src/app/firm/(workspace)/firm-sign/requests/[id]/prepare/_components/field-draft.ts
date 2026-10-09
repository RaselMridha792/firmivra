import {
  type EsignField,
  type EsignFieldType,
  type EsignMergeKey,
  EsignPutFieldsBody,
} from '@firmivra/types';

/** One field as the editor changes it. Positions are fractions of the page as shown. */
export interface FieldDraft {
  /** A stable key for the list (the field's id once saved). */
  key: string;
  id?: string;
  recipientId: string | null;
  type: EsignFieldType;
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  required: boolean;
  label: string;
  mergeKey: EsignMergeKey | null;
  value: string;
  /** Kept as saved: the choices of a dropdown or radio field, and a radio field's group. */
  options: string[];
  groupKey: string | null;
}

let next = 0;
export const newKey = () => `new-field-${++next}`;

/** A new field's size, as a fraction of a letter page: about what each holds when printed. */
export const DEFAULT_SIZE: Record<EsignFieldType, { w: number; h: number }> = {
  SIGNATURE: { w: 0.28, h: 0.055 },
  INITIALS: { w: 0.09, h: 0.045 },
  DATE_SIGNED: { w: 0.16, h: 0.03 },
  PRINTED_NAME: { w: 0.28, h: 0.03 },
  EMAIL: { w: 0.28, h: 0.03 },
  PHONE: { w: 0.2, h: 0.03 },
  ADDRESS: { w: 0.4, h: 0.06 },
  TEXT: { w: 0.28, h: 0.03 },
  CHECKBOX: { w: 0.03, h: 0.023 },
  RADIO: { w: 0.03, h: 0.023 },
  DROPDOWN: { w: 0.2, h: 0.03 },
  ATTACHMENT: { w: 0.2, h: 0.04 },
};

/** The smallest a field gets when resized. */
export const MIN_SIZE = 0.015;

export const clamp01 = (n: number, size = 0) => Math.min(Math.max(n, 0), 1 - size);

export function fromField(f: EsignField): FieldDraft {
  return {
    key: f.id,
    id: f.id,
    recipientId: f.recipientId,
    type: f.type,
    pageIndex: f.pageIndex,
    x: f.x,
    y: f.y,
    w: f.w,
    h: f.h,
    required: f.required,
    label: f.label ?? '',
    mergeKey: f.mergeKey,
    value: f.value ?? '',
    options: f.options,
    groupKey: f.groupKey,
  };
}

/** A copy a little lower on the same page (or higher, when there is no room below). */
export function duplicate(f: FieldDraft): FieldDraft {
  const below = f.y + f.h * 1.5;
  return {
    ...f,
    key: newKey(),
    id: undefined,
    y: below + f.h <= 1 ? below : clamp01(f.y - f.h * 1.5, f.h),
  };
}

/** The PUT body, or the first problem and the field it is on. */
export function toBody(
  fields: FieldDraft[],
): { ok: true; body: EsignPutFieldsBody } | { ok: false; key?: string; message: string } {
  const parsed = EsignPutFieldsBody.safeParse({
    fields: fields.map((f) => ({
      ...(f.id && { id: f.id }),
      recipientId: f.recipientId,
      type: f.type,
      pageIndex: f.pageIndex,
      x: f.x,
      y: f.y,
      w: f.w,
      h: f.h,
      required: f.required,
      ...(f.label.trim() && { label: f.label }),
      options: f.options,
      ...(f.groupKey && { groupKey: f.groupKey }),
      // Only the sender's fields carry a value or a merge field.
      ...(f.recipientId === null && (f.mergeKey ? { mergeKey: f.mergeKey } : { value: f.value })),
    })),
  });
  if (parsed.success) return { ok: true, body: parsed.data };
  const issue = parsed.error.issues[0];
  const index = issue?.path[1];
  return {
    ok: false,
    key: typeof index === 'number' ? fields[index]?.key : undefined,
    message: issue?.message ?? 'Check the fields',
  };
}
