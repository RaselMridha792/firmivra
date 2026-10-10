'use client';

import type { EsignRecipient, EsignRecipientRole } from '@firmivra/types';
import { Button, Input, Select } from '@firmivra/ui';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import type { DraftErrors, RecipientDraft } from './recipient-draft';

const KIND: Record<EsignRecipient['kind'], string> = {
  SIGNER: 'Signer',
  APPROVER: 'Approver',
  CC: 'Gets a copy',
};

const ROLES: { value: EsignRecipientRole; label: string }[] = [
  { value: 'CLIENT', label: 'Client' },
  { value: 'SPOUSE', label: 'Spouse' },
  { value: 'BUSINESS_OWNER', label: 'Business owner' },
  { value: 'EMPLOYEE', label: 'Employee' },
  { value: 'PREPARER', label: 'Preparer' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'WITNESS', label: 'Witness' },
  { value: 'CUSTOM', label: 'Other (name it)' },
];

export interface Choice {
  value: string;
  label: string;
}

/** One recipient's boxes: who, their role, how they get it and how they prove who they are. */
export function RecipientRow({
  d,
  order,
  count,
  errors,
  logins,
  members,
  onChange,
  onMove,
  onRemove,
}: {
  d: RecipientDraft;
  /** Their place in the signing order (null when everyone signs at once). */
  order: number | null;
  count: number;
  errors: DraftErrors;
  /** The client's active portal logins, as `login:<id>`. */
  logins: Choice[];
  /** The firm's members, as `staff:<id>` (approvers, and staff who sign). */
  members: Choice[];
  onChange: (patch: Partial<RecipientDraft>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const index = order ?? 0;
  const title = `${order ? `${order}. ` : ''}${KIND[d.kind]}`;
  const isLogin = d.who.startsWith('login:');
  const signer = d.kind === 'SIGNER';
  const offered: Choice[] =
    d.kind === 'APPROVER'
      ? [{ value: '', label: 'Choose a member of the firm' }, ...members]
      : [...logins, ...(signer ? members : []), { value: 'external', label: 'Someone else' }];
  // A saved login or member these lists no longer offer (or cannot load) still shows as itself.
  const whoOptions = offered.some((o) => o.value === d.who)
    ? offered
    : [{ value: d.who, label: d.savedLabel }, ...offered];
  return (
    <li data-testid="recipient-row" className="flex flex-col gap-3 py-4 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-heading">{title}</h3>
        <div className="flex gap-1">
          {order && (
            <>
              <Button
                variant="ghost"
                aria-label={`Move ${title} up`}
                disabled={index <= 1}
                onClick={() => onMove(-1)}
              >
                <ArrowUp aria-hidden className="size-4" />
              </Button>
              <Button
                variant="ghost"
                aria-label={`Move ${title} down`}
                disabled={index >= count}
                onClick={() => onMove(1)}
              >
                <ArrowDown aria-hidden className="size-4" />
              </Button>
            </>
          )}
          <Button variant="ghost" aria-label={`Remove ${title}`} onClick={onRemove}>
            <Trash2 aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Select
          label={d.kind === 'APPROVER' ? 'Who approves' : 'Who'}
          value={d.who}
          error={errors.who}
          onChange={(e) => {
            const who = e.target.value;
            // The portal is only for the client's own login.
            const delivery =
              d.delivery === 'PORTAL' && !who.startsWith('login:') ? 'EMAIL' : d.delivery;
            onChange({ who, delivery });
          }}
          options={whoOptions}
        />
        {signer && (
          <Select
            label="Role"
            value={d.role}
            onChange={(e) => onChange({ role: e.target.value as EsignRecipientRole })}
            options={ROLES}
          />
        )}
        {signer && d.role === 'CUSTOM' && (
          <Input
            label="Role name"
            maxLength={60}
            value={d.roleLabel}
            error={errors.roleLabel}
            onChange={(e) => onChange({ roleLabel: e.target.value })}
          />
        )}
        {d.who === 'external' && (
          <>
            <Input
              label="Name"
              maxLength={120}
              value={d.name}
              error={errors.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
            <Input
              label="Email"
              type="email"
              value={d.email}
              error={errors.email}
              onChange={(e) => onChange({ email: e.target.value })}
            />
            <Input
              label="Mobile phone (optional)"
              type="tel"
              value={d.phone}
              error={errors.phone}
              onChange={(e) => onChange({ phone: e.target.value })}
            />
          </>
        )}
        {signer && (
          <Select
            label="How they sign"
            value={d.delivery}
            error={errors.delivery}
            onChange={(e) => onChange({ delivery: e.target.value as RecipientDraft['delivery'] })}
            options={[
              { value: 'EMAIL', label: 'By email' },
              ...(isLogin ? [{ value: 'PORTAL', label: 'In the client portal' }] : []),
              { value: 'IN_PERSON', label: 'In person, on this device' },
            ]}
          />
        )}
        {signer && d.delivery !== 'IN_PERSON' && (
          <Select
            label="Identity check"
            value={d.authMethod}
            onChange={(e) =>
              onChange({ authMethod: e.target.value as RecipientDraft['authMethod'] })
            }
            options={[
              { value: 'EMAIL_CODE', label: 'A code sent by email' },
              { value: 'ACCESS_CODE', label: 'An access code you give them' },
              { value: 'LINK', label: 'Their link only' },
            ]}
          />
        )}
        {signer && d.delivery !== 'IN_PERSON' && d.authMethod === 'ACCESS_CODE' && (
          <Input
            label={d.hasAccessCode ? 'New access code (leave empty to keep it)' : 'Access code'}
            maxLength={20}
            autoComplete="off"
            value={d.accessCode}
            error={errors.accessCode}
            onChange={(e) => onChange({ accessCode: e.target.value })}
          />
        )}
      </div>
      {errors.row && (
        <p role="alert" className="text-sm text-danger">
          {errors.row}
        </p>
      )}
    </li>
  );
}
