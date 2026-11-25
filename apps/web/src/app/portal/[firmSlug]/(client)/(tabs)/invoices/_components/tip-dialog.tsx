'use client';

import { INVOICE_LIMITS, type MyInvoice } from '@firmivra/types';
import { Button, Input, Modal, Radio } from '@firmivra/ui';
import { useState } from 'react';

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(
    cents / 100,
  );

type Choice = 'NONE' | '10' | '15' | '20' | 'CUSTOM';
const PERCENTS = ['10', '15', '20'] as const;

/**
 * Q22 (I-N05, R1-4): the tip, in whole cents, for a choice; or the reason a custom amount is not
 * accepted. A percentage is of the balance due, rounded to the cent. At most the balance, and the
 * balance plus the tip within the largest card payment (as the API checks).
 */
export function tipFor(
  choice: Choice,
  balanceCents: number,
  custom: string,
): { cents: number } | { error: string } {
  if (choice === 'NONE') return { cents: 0 };
  if (choice !== 'CUSTOM') return { cents: Math.round((balanceCents * Number(choice)) / 100) };
  const text = custom.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Enter an amount, like 12.50.' };
  const cents = Math.round(Number(text) * 100);
  if (cents > balanceCents || balanceCents + cents > INVOICE_LIMITS.maxCents) {
    return { error: 'The tip can be at most the amount due.' };
  }
  return { cents };
}

/**
 * Before Stripe, on an invoice that offers a tip: No tip, 10%, 15%, 20% or a custom amount, with
 * the total that will be charged. The tip goes to the firm and does not pay the invoice.
 */
export function TipDialog({
  invoice,
  busy,
  onPay,
  onClose,
}: {
  invoice: MyInvoice;
  busy: boolean;
  onPay: (tipCents: number) => void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<Choice>('NONE');
  const [custom, setCustom] = useState('');
  const [tried, setTried] = useState(false);
  const balance = invoice.balanceDueCents;
  const tip = tipFor(choice, balance, custom);
  const cents = 'cents' in tip ? tip.cents : 0;
  const option = (value: Choice, label: string) => (
    <Radio
      key={value}
      name={`tip-${invoice.id}`}
      label={label}
      value={value}
      checked={choice === value}
      onChange={() => {
        setChoice(value);
        setTried(false);
      }}
    />
  );
  return (
    <Modal
      open
      title="Add a tip?"
      subtitle={`${invoice.number} · Amount due ${money(balance, invoice.currency)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setTried(true);
              if ('cents' in tip) onPay(tip.cents);
            }}
            className="bg-firm-button! hover:bg-firm-button-hover! disabled:bg-disabled! disabled:text-disabled-text!"
          >
            Continue to Payment
          </Button>
        </>
      }
    >
      <fieldset className="flex flex-col" data-testid="tip-choices">
        <legend className="mb-1 text-sm font-medium text-text">Tip</legend>
        {option('NONE', 'No tip')}
        {PERCENTS.map((p) =>
          option(p, `${p}% (${money(Math.round((balance * Number(p)) / 100), invoice.currency)})`),
        )}
        {option('CUSTOM', 'Custom amount')}
      </fieldset>
      {choice === 'CUSTOM' ? (
        <div className="mt-2 max-w-xs">
          <Input
            label="Tip amount ($)"
            inputMode="decimal"
            autoFocus
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              setTried(false);
            }}
            error={tried && 'error' in tip ? tip.error : undefined}
          />
        </div>
      ) : null}
      <dl
        className="mt-4 flex flex-col gap-1 border-t border-divider pt-3 text-sm"
        data-testid="tip-total"
      >
        <div className="flex justify-between">
          <dt className="text-muted">Invoice</dt>
          <dd>{money(balance, invoice.currency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Tip</dt>
          <dd>{money(cents, invoice.currency)}</dd>
        </div>
        <div className="flex justify-between font-semibold text-heading">
          <dt>Total charged</dt>
          <dd>{money(balance + cents, invoice.currency)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted">
        The tip goes to the firm. It is charged with this payment and does not count toward the
        invoice.
      </p>
    </Modal>
  );
}
