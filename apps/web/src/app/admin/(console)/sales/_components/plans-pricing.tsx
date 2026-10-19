'use client';

import { Button, Modal } from '@firmivra/ui';
import {
  ArrowRight,
  BuildingOffice,
  Check,
  Crown,
  FileText,
  Tag,
  User,
  Users,
  type Icon,
} from '@phosphor-icons/react';
import { useApiQuery } from '../../../../../lib/query';
import { adminSales, type PlanId, type SalesPlan } from './sales-api';
import { FrameState, moneyExact, SALES_KEY } from './sales-ui';

/** Each plan's colour: icon tile, ticks and its main button (white text only where it reads). */
const PLAN_STYLE: Record<PlanId, { icon: Icon; tile: string; tick: string; button: string }> = {
  SOLO_CORE: {
    icon: User,
    tile: 'bg-info-soft text-action',
    tick: 'text-action',
    button: 'bg-action text-on-action hover:bg-action-hover',
  },
  SOLO_PRO: {
    icon: User,
    tile: 'bg-success-soft text-success',
    tick: 'text-success',
    button: 'bg-success text-on-action hover:bg-success/90',
  },
  SOLO_ELITE: {
    icon: Crown,
    tile: 'bg-purple-soft text-purple',
    tick: 'text-purple',
    button: 'bg-purple text-on-action hover:bg-purple/90',
  },
  TEAM_PRO: {
    icon: Users,
    tile: 'bg-warning-soft text-gold',
    tick: 'text-gold',
    // Navy text: white on this amber would not meet the contrast minimum.
    button: 'bg-gold text-heading hover:bg-gold/90',
  },
  BUSINESS: {
    icon: FileText,
    tile: 'bg-danger-soft text-danger',
    tick: 'text-danger',
    button: 'bg-danger text-on-action hover:bg-danger/90',
  },
  ENTERPRISE: {
    icon: BuildingOffice,
    tile: 'bg-table-head text-heading',
    tick: 'text-heading',
    button: 'bg-heading text-on-action hover:bg-navigation-hover',
  },
};

const wholeDollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`;

/**
 * Plans & Pricing: the six firm plans with their prices from the pricing document. A plan's main
 * button starts a trial (Enterprise: Contact Sales opens a proposal); View Details shows the plan.
 */
export function PlansPricing({
  onTrial,
  onContactSales,
  onDetails,
  onCompare,
}: {
  onTrial: (plan: PlanId) => void;
  onContactSales: (plan: PlanId) => void;
  onDetails: (plan: SalesPlan) => void;
  onCompare: () => void;
}) {
  const plans = useApiQuery([...SALES_KEY, 'plans'], () => adminSales.plans());
  return (
    <section
      aria-labelledby="plans-pricing-title"
      data-testid="plans-pricing"
      className="flex flex-col gap-3 rounded-xl bg-surface p-4 shadow-md"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <h2
            id="plans-pricing-title"
            className="flex items-center gap-2 text-lg font-semibold text-heading"
          >
            <Tag aria-hidden weight="fill" className="size-6 text-action" />
            Plans &amp; Pricing
          </h2>
          <p className="text-sm text-text">
            Present our plans, start a 14-day trial, or create a new opportunity.
          </p>
        </div>
        <button
          type="button"
          onClick={onCompare}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-action hover:underline"
        >
          Compare All Packages
          <ArrowRight aria-hidden weight="bold" className="size-4" />
        </button>
      </div>
      <FrameState query={plans} empty="No plans are set up yet." lines={3}>
        {(list) => (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 min-[1440px]:grid-cols-6">
            {list.map((plan) => {
              const style = PLAN_STYLE[plan.id];
              const Glyph = style.icon;
              return (
                <li
                  key={plan.id}
                  data-testid={`plan-${plan.id}`}
                  className="flex min-w-0 flex-col gap-2 rounded-xl border border-divider p-3"
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${style.tile}`}
                    >
                      <Glyph aria-hidden weight="fill" className="size-6" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-heading">{plan.name}</h3>
                      {plan.tagline ? <p className="text-xs text-muted">{plan.tagline}</p> : null}
                    </div>
                  </div>
                  <p className="flex flex-wrap items-baseline gap-1 text-heading">
                    {plan.priceFrom ? <span className="text-sm font-medium">From</span> : null}
                    <span className="text-2xl font-bold">{wholeDollars(plan.priceCents)}</span>
                    <span className="text-sm text-text">/ month</span>
                  </p>
                  <ul className="flex flex-1 flex-col gap-1 text-sm text-text">
                    {plan.highlights.map((line) => (
                      <li key={line} className="flex items-start gap-2">
                        <Check
                          aria-hidden
                          weight="bold"
                          className={`mt-0.5 size-4 shrink-0 ${style.tick}`}
                        />
                        {line}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => (plan.trial ? onTrial(plan.id) : onContactSales(plan.id))}
                    className={`min-h-9 rounded-lg px-2 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${style.button}`}
                  >
                    {plan.trial ? 'Start 14-Day Trial' : 'Contact Sales'}
                    <span className="sr-only"> for {plan.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDetails(plan)}
                    className="min-h-9 rounded-lg border border-action bg-surface px-2 py-1.5 text-sm font-medium text-action hover:bg-info-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    View Details<span className="sr-only"> of {plan.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </FrameState>
    </section>
  );
}

/** One plan in full: outcome, capacity, every feature and when to move up. */
export function PlanDetailsModal({
  plan,
  onClose,
  onTrial,
  onContactSales,
}: {
  plan: SalesPlan;
  onClose: () => void;
  onTrial: (plan: PlanId) => void;
  onContactSales: (plan: PlanId) => void;
}) {
  // The API stores no plan copy (outcome, best fit, when to move up): those lines stay out.
  const rows = (
    [
      ['Price', `${plan.priceFrom ? 'From ' : ''}${moneyExact(plan.priceCents)} a month`],
      ['Capacity', plan.capacity],
      ['Expansion', plan.expansion],
      ['Locations', plan.locations],
      ['Best fit', plan.bestFit],
    ] satisfies [string, string][]
  ).filter(([, value]) => value);
  return (
    <Modal
      open
      title={plan.name}
      subtitle={plan.outcome ? `${plan.outcome}: ${plan.whyUpgrade}` : undefined}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => (plan.trial ? onTrial(plan.id) : onContactSales(plan.id))}>
            {plan.trial ? 'Start 14-Day Trial' : 'Contact Sales'}
          </Button>
        </>
      }
    >
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="font-medium text-heading">{term}</dt>
            <dd className="text-text sm:col-span-2">{value}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-4 mb-2 text-sm font-semibold text-heading">Included</h3>
      <ul className="grid gap-1.5 text-sm text-text sm:grid-cols-2">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <Check aria-hidden weight="bold" className="mt-0.5 size-4 shrink-0 text-success" />
            {feature}
          </li>
        ))}
      </ul>
      {plan.upgradeTrigger ? (
        <p className="mt-4 rounded-lg bg-info-soft p-3 text-sm text-text">
          <span className="font-semibold text-heading">When to move up: </span>
          {plan.upgradeTrigger}
        </p>
      ) : null}
    </Modal>
  );
}

/** Compare All Packages: the pricing summary table. */
export function ComparePackagesModal({ onClose }: { onClose: () => void }) {
  const plans = useApiQuery([...SALES_KEY, 'plans'], () => adminSales.plans());
  const head = 'px-2 py-2 text-left font-medium whitespace-nowrap';
  return (
    <Modal
      open
      title="Compare All Packages"
      subtitle="Firm-level plans. The Sales Center itself is part of the Super Admin console only."
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <FrameState query={plans} empty="No plans are set up yet." lines={6}>
        {(list) => (
          <div className="overflow-x-auto">
            <table className="w-full min-w-xl text-sm text-text">
              <caption className="sr-only">Plans, prices and capacity</caption>
              <thead className="bg-table-head text-heading">
                <tr>
                  <th scope="col" className={head}>
                    Plan
                  </th>
                  <th scope="col" className={head}>
                    Base price
                  </th>
                  <th scope="col" className={head}>
                    Users
                  </th>
                  <th scope="col" className={head}>
                    Expansion
                  </th>
                  <th scope="col" className={head}>
                    Best fit
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((plan) => (
                  <tr key={plan.id} className="border-b border-divider align-top last:border-0">
                    <th scope="row" className="px-2 py-2 text-left font-semibold text-heading">
                      {plan.name}
                      <span className="block text-xs font-normal text-muted">{plan.outcome}</span>
                    </th>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {plan.priceFrom ? 'From ' : ''}
                      {wholeDollars(plan.priceCents)}/mo
                    </td>
                    <td className="px-2 py-2">{plan.capacity}</td>
                    <td className="px-2 py-2">{plan.expansion}</td>
                    <td className="px-2 py-2">{plan.bestFit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </FrameState>
    </Modal>
  );
}
