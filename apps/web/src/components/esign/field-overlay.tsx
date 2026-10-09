'use client';

import type { EsignField, EsignFieldType, EsignRecipient } from '@firmivra/types';
import { recipientColor, recipientWash } from './recipient-colors';

export const FIELD_TYPE_LABELS: Record<EsignFieldType, string> = {
  SIGNATURE: 'Signature',
  INITIALS: 'Initials',
  DATE_SIGNED: 'Date signed',
  PRINTED_NAME: 'Name',
  EMAIL: 'Email',
  PHONE: 'Phone',
  ADDRESS: 'Address',
  TEXT: 'Text',
  CHECKBOX: 'Checkbox',
  RADIO: 'Choice',
  DROPDOWN: 'Dropdown',
  ATTACHMENT: 'Attachment',
};

export type OverlayField = Pick<
  EsignField,
  | 'id'
  | 'recipientId'
  | 'type'
  | 'pageIndex'
  | 'x'
  | 'y'
  | 'w'
  | 'h'
  | 'required'
  | 'label'
  | 'filled'
>;
export type OverlayRecipient = Pick<EsignRecipient, 'id' | 'name' | 'colorIndex'>;

interface FieldOverlayProps {
  /** Every field of the document; only this page's are drawn. */
  fields: readonly OverlayField[];
  recipients: readonly OverlayRecipient[];
  pageIndex: number;
  /** The selected field (editor) or the current one (signer's Next). */
  activeId?: string | null;
  /** The signer's own recipient id: other people's fields fade, theirs stay bright. */
  ownerId?: string;
  onSelect?: (fieldId: string) => void;
}

/**
 * The fields on one PDF page, in their recipient's colour and labelled with the field and the
 * recipient's name. Positions are fractions of the page, so the boxes follow the page at any width.
 * Goes in PdfPages' `overlay` slot.
 */
export function FieldOverlay({
  fields,
  recipients,
  pageIndex,
  activeId,
  ownerId,
  onSelect,
}: FieldOverlayProps) {
  const byId = new Map(recipients.map((r) => [r.id, r]));
  return (
    <>
      {fields
        .filter((f) => f.pageIndex === pageIndex)
        .map((f) => {
          const recipient = f.recipientId ? byId.get(f.recipientId) : undefined;
          // Sender-filled fields have no recipient: they take the neutral colour.
          const colour = recipient?.colorIndex ?? 7;
          const name = recipient?.name ?? 'Sender';
          const label = `${f.label || FIELD_TYPE_LABELS[f.type]}${f.required ? ' (required)' : ''}`;
          const others = ownerId !== undefined && f.recipientId !== ownerId;
          const active = f.id === activeId;
          const Box = onSelect ? 'button' : 'div';
          return (
            <Box
              key={f.id}
              {...(onSelect
                ? { type: 'button' as const, onClick: () => onSelect(f.id) }
                : { role: 'group' })}
              data-testid="esign-field"
              data-field={f.id}
              data-recipient={f.recipientId ?? undefined}
              data-filled={f.filled || undefined}
              data-active={active || undefined}
              aria-label={`${label}, ${name}${f.filled ? ', done' : ''}`}
              className={`@container absolute flex min-w-0 items-start overflow-hidden rounded-control border-2 text-left text-xs leading-tight ${
                active ? 'outline-2 outline-offset-2 outline-focus' : ''
              } ${others ? 'opacity-40' : ''}`}
              // Where the field sits and whose it is: data from the request, not design values.
              style={{
                left: `${f.x * 100}%`,
                top: `${f.y * 100}%`,
                width: `${f.w * 100}%`,
                height: `${f.h * 100}%`,
                borderColor: recipientColor(colour),
                borderStyle: f.filled ? 'solid' : 'dashed',
                backgroundColor: recipientWash(colour),
                color: recipientColor(colour),
              }}
            >
              <span className="truncate px-1 font-medium">
                {FIELD_TYPE_LABELS[f.type]}
                {f.required && <span aria-hidden="true"> *</span>}
                {/* The name when the box has room for it (the colour and aria-label always say it). */}
                <span className="hidden font-normal @[10rem]:inline"> · {name}</span>
              </span>
            </Box>
          );
        })}
    </>
  );
}
