'use client';

import type { PromotionCodeCheck } from '@firmivra/types';
import { Button, Input, Modal, Select } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { CATALOG_ERRORS, CATALOG_KEY, money } from './catalog-shared';

/** A calendar day ("2026-12-01") as "Dec 1, 2026", read at noon so no time zone moves it. */
const dayText = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const WHO: Record<NonNullable<PromotionCodeCheck['promotion']>['eligibility'], string | null> = {
  ALL_CLIENTS: null,
  NEW_CLIENTS: 'It is for new clients only.',
  EXISTING_CLIENTS: 'It is for existing clients only.',
};

/** The answer in the firm's words: what applies, or the one exact reason it does not (R13). */
export function checkText(c: PromotionCodeCheck): string {
  const name = c.promotion ? `“${c.promotion.name}”` : '';
  const list = c.scope.join(', ');
  switch (c.result) {
    case 'APPLIES':
      return c.discountCents === null
        ? `Applies: ${name}. The amount off is worked out once the price is quoted.`
        : `Applies: ${money(c.discountCents)} off ${money(c.priceCents)} with ${name}.`;
    case 'UNKNOWN_CODE':
      return 'No promotion uses this code. Check the spelling.';
    case 'NOT_ACTIVE':
      return `${name} is not live: it is a draft or has ended. Activate it to use the code.`;
    case 'NOT_STARTED':
      return `${name} has not started yet${c.promotion?.startsOn ? `: it starts on ${dayText(c.promotion.startsOn)}` : ''}.`;
    case 'EXPIRED':
      return `${name} has expired${c.promotion?.endsOn ? `: it ended on ${dayText(c.promotion.endsOn)}` : ''}.`;
    case 'WRONG_CATEGORY':
      return `${name} is for other categories${list ? `: ${list}` : ''}.`;
    case 'WRONG_SERVICE':
      return `${name} is for other services${list ? `: ${list}` : ''}.`;
    case 'WRONG_PACKAGE':
      return `${name} is for other packages${list ? `: ${list}` : ''}.`;
    case 'DOES_NOT_STACK':
      return `${name} does not stack with “${c.conflict?.name ?? 'another promotion'}”, which already applies to this item.`;
  }
}

/**
 * Services & Pricing Review Two R9/R13 (decided Nov 19), "Check a Code": a staff test of whether
 * a promo code applies to one of the firm's services or packages today. Nothing is ordered,
 * charged or counted; codes are not yet redeemed at payment.
 */
export function CheckCodeDialog({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('');
  const [itemType, setItemType] = useState<'SERVICE' | 'PACKAGE'>('SERVICE');
  const [itemId, setItemId] = useState('');
  const [missing, setMissing] = useState<{ code?: string; item?: string }>({});
  const services = useApiQuery([...CATALOG_KEY, 'services', 'check-code'], () =>
    api.servicesPricing.services({ status: 'all', pageSize: 100 }),
  );
  const packages = useApiQuery([...CATALOG_KEY, 'packages', 'check-code'], () =>
    api.servicesPricing.packages(),
  );
  const check = useApiMutation(() =>
    api.servicesPricing.checkPromotionCode({ code: code.trim(), itemType, itemId }),
  );
  const items =
    itemType === 'SERVICE'
      ? (services.data?.items ?? []).map((s) => ({ value: s.id, label: s.name }))
      : (packages.data ?? []).map((p) => ({ value: p.id, label: p.name }));
  const run = () => {
    const next = {
      ...(code.trim() ? {} : { code: 'Enter the code.' }),
      ...(itemId ? {} : { item: `Choose a ${itemType === 'SERVICE' ? 'service' : 'package'}.` }),
    };
    setMissing(next);
    if (next.code || next.item) {
      document.getElementById(next.code ? 'check-code' : 'check-item')?.focus();
      return;
    }
    check.mutate();
  };
  const answer = check.data;
  return (
    <Modal
      open
      title="Check a Code"
      subtitle="See whether a promo code applies to a service or package today. Nothing is ordered or charged."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button disabled={check.isPending} onClick={run} data-testid="check-code-run">
            Check
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          id="check-code"
          label="Promo code"
          value={code}
          error={missing.code}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase());
            check.reset();
          }}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Try it on"
            value={itemType}
            onChange={(event) => {
              setItemType(event.target.value === 'PACKAGE' ? 'PACKAGE' : 'SERVICE');
              setItemId('');
              check.reset();
            }}
            options={[
              { value: 'SERVICE', label: 'A service' },
              { value: 'PACKAGE', label: 'A package' },
            ]}
          />
          <Select
            id="check-item"
            label={itemType === 'SERVICE' ? 'Service' : 'Package'}
            value={itemId}
            error={missing.item}
            onChange={(event) => {
              setItemId(event.target.value);
              check.reset();
            }}
            options={[
              {
                value: '',
                label: (itemType === 'SERVICE' ? services : packages).isError
                  ? 'Not available right now'
                  : 'Choose one',
              },
              ...items,
            ]}
          />
        </div>
        {answer ? (
          <div
            role="status"
            data-testid="check-code-answer"
            className={`rounded-lg p-3 text-sm ${answer.result === 'APPLIES' ? 'bg-success-soft text-success' : 'bg-warning-soft text-text'}`}
          >
            <p className="font-semibold">{checkText(answer)}</p>
            {answer.promotion && WHO[answer.promotion.eligibility] ? (
              <p className="mt-1">{WHO[answer.promotion.eligibility]}</p>
            ) : null}
          </div>
        ) : null}
        {check.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(check.error, CATALOG_ERRORS)}
          </p>
        ) : null}
        <p className="text-xs text-muted">
          Codes are not yet redeemed at payment: this check is how to test one.
        </p>
      </div>
    </Modal>
  );
}
