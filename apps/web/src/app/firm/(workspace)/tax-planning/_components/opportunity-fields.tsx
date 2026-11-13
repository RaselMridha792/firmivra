'use client';

import type { TaxOpportunityDetail } from '@firmivra/types';
import { Checkbox, Input, Textarea } from '@firmivra/ui';
import { Plus, Trash } from '@phosphor-icons/react';
import { dollars, subtle, toDollars } from './tp-shared';

/**
 * C10 (Review 2): an opportunity's reasoning as staff write it: why it fits this client, the
 * figures it rests on, the recommended actions, the eligibility checks and assumptions, the basis
 * of the estimate and the documents needed. Used by Add Opportunity and Edit Details.
 */
export interface OpportunityDraft {
  why: string;
  basis: string;
  data: { label: string; value: string }[];
  actions: string;
  eligibility: { text: string; met: boolean }[];
  documents: string;
}

export const emptyDraft = (): OpportunityDraft => ({
  why: '',
  basis: '',
  data: [],
  actions: '',
  eligibility: [],
  documents: '',
});

/** The detail as a draft to edit. */
export const draftOf = (o: TaxOpportunityDetail): OpportunityDraft => ({
  why: o.whyExplanation ?? '',
  basis: o.estimate.basis ?? '',
  data: (o.clientDataUsed ?? []).map((d) => ({
    label: d.label,
    value: d.amountCents !== null ? toDollars(d.amountCents) : (d.text ?? ''),
  })),
  actions: o.recommendedActions.join('\n'),
  eligibility: o.eligibility.map((e) => ({ text: e.text, met: e.met })),
  documents: o.documentsNeeded.map((d) => d.label).join('\n'),
});

const lines = (s: string) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

/** A figure is an amount when it reads as one ("12,500" or "$12,500.50"), else a value. */
const point = (d: { label: string; value: string }) => {
  const v = d.value.trim();
  return /^\$?-?[\d,]+(\.\d{1,2})?$/.test(v)
    ? { label: d.label.trim(), amountCents: dollars(v.replace(/[$,]/g, '')) }
    : { label: d.label.trim(), text: v };
};

/** The request fields of a draft (`withData`: the caller may see and send the figures). */
export const fieldsOf = (d: OpportunityDraft, withData: boolean) => ({
  whyExplanation: d.why.trim() || null,
  estimateBasis: d.basis.trim() || null,
  recommendedActions: lines(d.actions),
  eligibility: d.eligibility
    .filter((e) => e.text.trim())
    .map((e) => ({ text: e.text.trim(), met: e.met })),
  documentsNeeded: lines(d.documents),
  ...(withData
    ? { clientDataUsed: d.data.filter((x) => x.label.trim() && x.value.trim()).map(point) }
    : {}),
});

export function OpportunityFields({
  draft,
  onChange,
  showData,
}: {
  draft: OpportunityDraft;
  onChange: (d: OpportunityDraft) => void;
  /** False when the role may not see the client's figures. */
  showData: boolean;
}) {
  const set = (over: Partial<OpportunityDraft>) => onChange({ ...draft, ...over });
  return (
    <div className="flex flex-col gap-3" data-testid="opportunity-fields">
      <Textarea
        label="Why This Opportunity"
        rows={3}
        value={draft.why}
        maxLength={2000}
        hint="What in the client's situation makes this worth reviewing."
        onChange={(e) => set({ why: e.target.value })}
      />
      {showData ? (
        <fieldset className="flex flex-col gap-2" data-testid="client-data-used">
          <legend className="text-sm font-medium text-heading">Client Data Used</legend>
          {draft.data.map((d, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <Input
                label={`Figure ${i + 1}`}
                value={d.label}
                placeholder="2025 W-2 wages"
                onChange={(e) =>
                  set({
                    data: draft.data.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                  })
                }
              />
              <Input
                label={`Amount or value ${i + 1}`}
                value={d.value}
                placeholder="85,000"
                onChange={(e) =>
                  set({
                    data: draft.data.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                  })
                }
              />
              <button
                type="button"
                aria-label={`Remove figure ${i + 1}`}
                className={`${subtle} min-h-10`}
                onClick={() => set({ data: draft.data.filter((_, j) => j !== i) })}
              >
                <Trash aria-hidden weight="bold" className="size-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className={`${subtle} w-fit`}
            disabled={draft.data.length >= 20}
            onClick={() => set({ data: [...draft.data, { label: '', value: '' }] })}
          >
            <Plus aria-hidden weight="bold" className="size-4" /> Add Figure
          </button>
        </fieldset>
      ) : null}
      <Textarea
        label="Recommended Actions (one per line)"
        rows={3}
        value={draft.actions}
        onChange={(e) => set({ actions: e.target.value })}
      />
      <fieldset className="flex flex-col gap-2" data-testid="eligibility-rows">
        <legend className="text-sm font-medium text-heading">Eligibility &amp; Assumptions</legend>
        {draft.eligibility.map((e, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
            <Input
              label={`Check ${i + 1}`}
              value={e.text}
              onChange={(ev) =>
                set({
                  eligibility: draft.eligibility.map((x, j) =>
                    j === i ? { ...x, text: ev.target.value } : x,
                  ),
                })
              }
            />
            <Checkbox
              label="Met"
              checked={e.met}
              onChange={(ev) =>
                set({
                  eligibility: draft.eligibility.map((x, j) =>
                    j === i ? { ...x, met: ev.target.checked } : x,
                  ),
                })
              }
            />
            <button
              type="button"
              aria-label={`Remove check ${i + 1}`}
              className={`${subtle} min-h-10`}
              onClick={() => set({ eligibility: draft.eligibility.filter((_, j) => j !== i) })}
            >
              <Trash aria-hidden weight="bold" className="size-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className={`${subtle} w-fit`}
          disabled={draft.eligibility.length >= 20}
          onClick={() => set({ eligibility: [...draft.eligibility, { text: '', met: false }] })}
        >
          <Plus aria-hidden weight="bold" className="size-4" /> Add Check
        </button>
      </fieldset>
      <Textarea
        label="Estimate Basis and Assumptions"
        rows={2}
        value={draft.basis}
        maxLength={500}
        onChange={(e) => set({ basis: e.target.value })}
      />
      <Textarea
        label="Documents Needed (one per line)"
        rows={2}
        value={draft.documents}
        onChange={(e) => set({ documents: e.target.value })}
      />
    </div>
  );
}
