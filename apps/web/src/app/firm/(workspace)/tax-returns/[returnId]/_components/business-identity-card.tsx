'use client';

import type {
  CorrectTaxReturnBusinessIdentityRequest,
  TaxReturnBusinessIdentity,
  TaxReturnDetail,
} from '@firmivra/types';
import { Input } from '@firmivra/ui';
import { Buildings } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { Dialog, useAct, type Notice } from '../../_components/return-actions';
import { Panel, textButton } from '../../_components/review-panels';

const missing = 'Not on this return';
const ADDRESS = ['addressLine1', 'addressLine2', 'city', 'state', 'postalCode'] as const;

/**
 * The business on this return (Octavia's TX-F31, F32; R1's #1176): the return's own copy of the
 * business name, EIN and address, taken from the client's record when the return was created, so
 * later changes to the client never rewrite it. Correctable until the return is first filed;
 * after that it stays as filed. Only the EIN's last 4 are ever shown.
 */
export function BusinessIdentityCard({
  detail,
  onNotice,
}: {
  detail: TaxReturnDetail;
  onNotice: Notice;
}) {
  const [editing, setEditing] = useState(false);
  const b = detail.businessIdentity;
  if (!b) return null;
  const street = [b.addressLine1, b.addressLine2].filter(Boolean).join(', ');
  const place = [[b.city, b.state].filter(Boolean).join(', '), b.postalCode]
    .filter(Boolean)
    .join(' ');
  const rows: [string, string | null][] = [
    ['Business Name', b.name],
    ['Business EIN', b.einLast4 ? `••-•••${b.einLast4}` : null],
    ['Business Address', [street, place].filter(Boolean).join('\n') || null],
  ];
  return (
    <Panel
      title="Business on This Return"
      icon={Buildings}
      testId="business-identity"
      action={
        b.correctable ? (
          <button type="button" className={textButton} onClick={() => setEditing(true)}>
            Correct
          </button>
        ) : null
      }
    >
      <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-heading">{k}</dt>
            <dd
              className={`min-w-0 border-b border-divider pb-2 whitespace-pre-line wrap-anywhere ${v ? 'text-text' : 'text-muted'}`}
            >
              {v ?? missing}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted">
        {b.correctable
          ? "Copied from the client's record when this return was created. Correct it here until the return is first filed; the client's record does not change."
          : 'Kept as filed: it no longer changes.'}
      </p>
      {editing ? (
        <CorrectDialog
          detail={detail}
          identity={b}
          onClose={() => setEditing(false)}
          onNotice={onNotice}
        />
      ) : null}
    </Panel>
  );
}

/** Correct the return's copy: only what changed is sent; an empty EIN keeps the one on file. */
function CorrectDialog({
  detail,
  identity,
  onClose,
  onNotice,
}: {
  detail: TaxReturnDetail;
  identity: TaxReturnBusinessIdentity;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(identity.name ?? '');
  const [ein, setEin] = useState('');
  const [address, setAddress] = useState(
    Object.fromEntries(ADDRESS.map((k) => [k, identity[k] ?? ''])) as Record<
      (typeof ADDRESS)[number],
      string
    >,
  );
  const body: CorrectTaxReturnBusinessIdentityRequest = {
    ...(name.trim() !== (identity.name ?? '') ? { name: name.trim() } : {}),
    ...(ein.trim() ? { ein: ein.trim() } : {}),
    ...Object.fromEntries(
      ADDRESS.filter((k) => address[k].trim() !== (identity[k] ?? '')).map((k) => [
        k,
        address[k].trim(),
      ]),
    ),
  };
  const changed = Object.keys(body).length > 0;
  const save = async () => {
    setBusy(true);
    const done = await act(
      () => api.taxReturnWorkspace.correctBusinessIdentity(detail.id, body),
      "The return's business details are corrected.",
    );
    setBusy(false);
    if (done) onClose();
  };
  const field = (k: (typeof ADDRESS)[number]) => ({
    value: address[k],
    onChange: (e: { target: { value: string } }) => setAddress({ ...address, [k]: e.target.value }),
  });
  return (
    <Dialog
      title="Correct the Business on This Return"
      subtitle={`${detail.client.name}, ${detail.taxYear}`}
      confirm="Save"
      busy={busy}
      disabled={!changed}
      onConfirm={() => void save()}
      onClose={onClose}
      testId="identity-dialog"
    >
      <Input
        label="Business name"
        value={name}
        maxLength={200}
        onChange={(e) => setName(e.target.value)}
      />
      <Input
        label="Business EIN"
        inputMode="numeric"
        placeholder={
          identity.einLast4 ? `Leave empty to keep ••-•••${identity.einLast4}` : '9 digits'
        }
        value={ein}
        maxLength={10}
        onChange={(e) => setEin(e.target.value)}
      />
      <Input label="Address line 1" maxLength={200} {...field('addressLine1')} />
      <Input label="Address line 2" maxLength={200} {...field('addressLine2')} />
      <div className="grid gap-4 sm:grid-cols-[1fr_6rem_8rem]">
        <Input label="City" maxLength={100} {...field('city')} />
        <Input label="State" maxLength={50} {...field('state')} />
        <Input label="ZIP code" maxLength={10} {...field('postalCode')} />
      </div>
      <p className="text-xs text-muted">
        This changes the return only. The client&apos;s record stays as it is.
      </p>
    </Dialog>
  );
}
