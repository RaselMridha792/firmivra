'use client';

import type { EsignField, EsignRecipient } from '@firmivra/types';
import type { ReactNode } from 'react';
import { FIELD_TYPE_LABELS } from './field-labels';
import { recipientColor, SENDER_COLOR, washOf } from './recipient-colors';

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
  | 'value'
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
  /** The signer's own recipient id: other signers' fields fade, theirs stay bright. */
  ownerId?: string;
  onSelect?: (fieldId: string) => void;
  /** What a filled field shows instead of its name (the signer's adopted signature). */
  display?: (field: OverlayField) => ReactNode;
}

/** Keeps a box on its page: the schema checks each number alone, not x + w or y + h. */
function clamp(start: number, size: number) {
  const s = Math.min(Math.max(size, 0), 1);
  return { start: Math.min(Math.max(start, 0), 1 - s), size: s };
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
  display,
}: FieldOverlayProps) {
  return (
    <>
      {fields
        .filter((f) => f.pageIndex === pageIndex)
        .map((f) => {
          const recipient = f.recipientId
            ? recipients.find((r) => r.id === f.recipientId)
            : undefined;
          const colour = recipient ? recipientColor(recipient.colorIndex) : SENDER_COLOR;
          const name = recipient?.name ?? 'Sender';
          const title = f.label || FIELD_TYPE_LABELS[f.type];
          // A value the sender filled in is shown as it will print; the signer must see it. So
          // is what the signer typed in their own fields.
          const mine = !f.recipientId || (ownerId !== undefined && f.recipientId === ownerId);
          const value = mine && f.value ? f.value : null;
          const shown = display?.(f) ?? (value ? <span className="text-text">{value}</span> : null);
          const label = `${title}${f.required ? ' (required)' : ''}, ${name}${
            value ? `: ${value}` : ''
          }${f.filled ? ', done' : ''}`;
          // Only other signers' fields fade; the sender's stay readable.
          const others = ownerId !== undefined && !!f.recipientId && f.recipientId !== ownerId;
          const active = f.id === activeId;
          const x = clamp(f.x, f.w);
          const y = clamp(f.y, f.h);
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
              aria-label={label}
              className={`@container absolute flex min-w-0 items-start overflow-hidden rounded-control border-2 text-left text-xs leading-tight ${
                active ? 'outline-2 outline-offset-2 outline-focus' : ''
              } ${others ? 'opacity-40' : ''}`}
              // Where the field sits and whose it is: data from the request, not design values.
              style={{
                left: `${x.start * 100}%`,
                top: `${y.start * 100}%`,
                width: `${x.size * 100}%`,
                height: `${y.size * 100}%`,
                borderColor: colour,
                borderStyle: f.filled || shown ? 'solid' : 'dashed',
                backgroundColor: washOf(colour),
                color: colour,
              }}
            >
              <span className="truncate px-1 font-medium">
                {shown ?? (
                  <>
                    {title}
                    {f.required && <span aria-hidden="true"> *</span>}
                    {/* The name when the box has room (the colour and aria-label always say it). */}
                    <span className="hidden font-normal @[10rem]:inline"> · {name}</span>
                  </>
                )}
              </span>
            </Box>
          );
        })}
    </>
  );
}
