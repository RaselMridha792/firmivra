'use client';

import { Button, Callout, Checkbox, FormField, Modal, Skeleton } from '@firmivra/ui';
import {
  ArrowLeft,
  CaretDown,
  Eye,
  GearSix,
  Info,
  PaperPlaneTilt,
  Plus,
  Trash,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { useMe } from '../../../../../../components/signed-in';
import {
  adminBilling,
  computeTotals,
  ESTIMATE_TEMPLATES,
  estimateErrors,
  hasErrors,
  type BillingAdmin,
  type BillingClient,
  type BillingEstimate,
  type BillingFirm,
  type BillingSettings,
  type Currency,
  type EstimateSetStatus,
  type EstimateStatus,
  type EstimateTemplate,
  type LineErrors,
  type SaveEstimate,
} from '../../../../../../mocks/admin-billing';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  compactText,
  DateControl,
  inputClass,
  SelectControl,
} from '../../_components/billing-fields';
import {
  addDays,
  formatMoney,
  moneyInput,
  parseMoney,
  parseQuantity,
  todayIso,
} from '../../_components/billing-format';
import {
  BILLING_ERRORS,
  ESTIMATE_STATUS_LABELS,
  ESTIMATE_TEMPLATE_LABELS,
  optionsOf,
} from '../../_components/billing-labels';
import { BillingCard, QuietLine, quietErrorText } from '../../_components/billing-parts';
import { BillingHeader, type Crumb } from '../../_components/billing-shell';
import { DocumentViewer } from '../../_components/invoice-document';
import { EstimateDocument, type EstimateDocumentData } from './estimate-document';

/**
 * Create Estimate and Edit Estimate: one form (modern-estimate-creation-dashboard.jpg, docx §11).
 * Edit mode loads the estimate and keeps its id and history. The firm is the client's firm, and
 * its estimate terms fill Terms & Conditions (or the platform default from Billing Settings).
 * Totals update live and are recalculated by the mock on save.
 */

let lineSeq = 0;
/** A key for a new line (never an index). */
const newKey = (prefix: string) => {
  lineSeq += 1;
  return `${prefix}-${lineSeq}`;
};

interface LineDraft {
  key: string;
  description: string;
  quantity: string;
  rate: string;
}
interface Draft {
  clientId: string;
  contactName: string;
  email: string;
  phone: string;
  number: string;
  issueDate: string;
  expirationDate: string;
  reference: string;
  lines: LineDraft[];
  discount: string;
  taxRateId: string;
  notes: string;
  /** Only used once the terms were edited; until then the firm's terms show. */
  terms: string;
  status: EstimateSetStatus;
  sendNotification: boolean;
  template: EstimateTemplate;
  assignedToId: string;
}

/** The statuses the form can set; Expired and Converted are derived (docx §10.1). */
const SETTABLE_STATUSES: EstimateSetStatus[] = ['DRAFT', 'SENT', 'PENDING', 'APPROVED', 'DECLINED'];
function settableOf(status: EstimateStatus): EstimateSetStatus {
  if (status === 'EXPIRED') return 'SENT';
  if (status === 'CONVERTED') return 'APPROVED';
  return status;
}

const SYMBOLS: Record<Currency, string> = { USD: '$', CAD: '$', EUR: '€', GBP: '£' };
/** "1,250.00": the line amount as drawn, without the currency sign. */
const plainAmount = (cents: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    cents / 100,
  );
/** Whole days between two YYYY-MM-DD dates; NaN when either is not a date. */
const gapDays = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const blankLine = (): LineDraft => ({
  key: newKey('line'),
  description: '',
  quantity: '1',
  rate: '',
});

function draftOf(estimate: BillingEstimate): Draft {
  return {
    clientId: estimate.clientId,
    contactName: estimate.contactName,
    email: estimate.email,
    phone: estimate.phone,
    number: estimate.number,
    issueDate: estimate.issueDate,
    expirationDate: estimate.expirationDate,
    reference: estimate.reference,
    lines: estimate.lines.length
      ? estimate.lines.map((line) => ({
          key: newKey('line'),
          description: line.description,
          quantity: String(line.quantity),
          rate: moneyInput(line.rateCents),
        }))
      : [blankLine()],
    discount: estimate.discountCents ? moneyInput(estimate.discountCents) : '',
    taxRateId: estimate.taxRateId ?? '',
    notes: estimate.notes,
    terms: estimate.terms,
    status: settableOf(estimate.status),
    sendNotification: estimate.sendNotification,
    template: estimate.template,
    assignedToId: estimate.assignedToId ?? '',
  };
}

function blankDraft(settings: BillingSettings, number: string, assignedToId: string): Draft {
  const today = todayIso();
  return {
    clientId: '',
    contactName: '',
    email: '',
    phone: '',
    number,
    issueDate: today,
    expirationDate: addDays(today, settings.general.estimateValidityDays),
    reference: '',
    lines: [blankLine()],
    discount: '',
    taxRateId: '',
    notes: '',
    terms: settings.general.termsAndConditions,
    status: 'DRAFT',
    sendNotification: true,
    template: settings.invoices.estimateTemplate,
    assignedToId,
  };
}

function bodyOf(draft: Draft, terms: string, send: boolean): SaveEstimate {
  return {
    clientId: draft.clientId,
    contactName: draft.contactName,
    email: draft.email,
    phone: draft.phone,
    number: draft.number,
    issueDate: draft.issueDate,
    expirationDate: draft.expirationDate,
    reference: draft.reference,
    lines: draft.lines.map((line) => ({
      description: line.description,
      quantity: parseQuantity(line.quantity),
      rateCents: line.rate.trim() ? (parseMoney(line.rate) ?? Number.NaN) : Number.NaN,
    })),
    discountCents: draft.discount.trim() ? (parseMoney(draft.discount) ?? Number.NaN) : 0,
    taxRateId: draft.taxRateId || null,
    notes: draft.notes,
    terms,
    status: draft.status,
    sendNotification: draft.sendNotification,
    template: draft.template,
    assignedToId: draft.assignedToId || null,
    send,
  };
}

/** What Back compares against to know whether anything changed. */
const signature = (draft: Draft, termsTouched: boolean) =>
  JSON.stringify({
    ...draft,
    lines: draft.lines.map(({ key: _key, ...line }) => line),
    terms: termsTouched ? draft.terms : null,
  });

function crumbs(estimate: BillingEstimate | null): Crumb[] {
  if (!estimate)
    return [
      { label: 'Billing', href: '/billing' },
      { label: 'Estimates', href: '/billing/estimates' },
      { label: 'Create Estimate' },
    ];
  return [
    { label: 'Billing', href: '/billing' },
    { label: 'Estimates', href: '/billing/estimates' },
    { label: estimate.number, href: `/billing/estimates?estimate=${estimate.id}` },
    { label: 'Edit' },
  ];
}

const TITLES = {
  create: {
    title: 'Create Estimate',
    subtitle:
      'Send a professional estimate to your client. Estimates can be converted to invoices once approved.',
  },
  edit: {
    title: 'Edit Estimate',
    subtitle: 'Update the estimate details below. Totals are recalculated when you save.',
  },
} as const;

/** "← Back to Estimates": a secondary button that is a link. */
function BackLink({
  href,
  onClick,
}: {
  href: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border bg-surface px-4 py-2 text-sm font-medium text-heading hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <ArrowLeft aria-hidden weight="fill" className="size-4" />
      Back to Estimates
    </Link>
  );
}

/** "+ Add New Client": clients are created in Leads / CRM (docx §11.1), not built yet. */
function AddClientNote() {
  return (
    <span
      aria-disabled="true"
      title="New clients are added in Leads / CRM once that module is built."
      className="inline-flex items-center gap-1.5 text-base font-medium text-muted"
    >
      <Plus aria-hidden weight="bold" className="size-4" />
      Add New Client
      <span className="sr-only">(not available yet)</span>
    </span>
  );
}

/** The Create / Edit Estimate screen: loads what the form needs, then shows it. */
export function EstimateEditor({
  mode,
  estimateId,
}: {
  mode: 'create' | 'edit';
  estimateId?: string;
}) {
  const settings = useApiQuery(['admin-billing', 'settings'], () => adminBilling.settings());
  const firms = useApiQuery(['admin-billing', 'firms'], () => adminBilling.firms());
  const clients = useApiQuery(['admin-billing', 'clients', 'all'], () => adminBilling.clients());
  const admins = useApiQuery(['admin-billing', 'admins'], () => adminBilling.admins());
  // One fetch per visit: a cached number or estimate may already be out of date.
  const [visit] = useState(() => newKey('visit'));
  const source = useApiQuery(
    ['admin-billing', 'estimate-source', mode, estimateId ?? '', visit],
    async () =>
      mode === 'edit' && estimateId
        ? { estimate: await adminBilling.estimate(estimateId), number: '' }
        : { estimate: null, number: await adminBilling.nextNumber('estimate') },
  );
  const failed = settings.error ?? firms.error ?? clients.error ?? admins.error ?? source.error;

  if (settings.data && firms.data && clients.data && admins.data && source.data) {
    return (
      <EstimateForm
        mode={mode}
        settings={settings.data}
        firms={firms.data}
        clients={clients.data}
        admins={admins.data}
        estimate={source.data.estimate}
        suggestedNumber={source.data.number}
      />
    );
  }
  const body = failed ? (
    <QuietLine testId="form-error">{quietErrorText(failed)}</QuietLine>
  ) : (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3">
      {['a', 'b', 'c'].map((key) => (
        <Skeleton key={key} className="h-10" />
      ))}
    </div>
  );
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <BillingHeader
        title={TITLES[mode].title}
        subtitle={TITLES[mode].subtitle}
        breadcrumbs={crumbs(null).map((crumb) =>
          crumb.label === 'Create Estimate' && mode === 'edit' ? { label: 'Edit' } : crumb,
        )}
        actions={<BackLink href="/billing/estimates" />}
      />
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <BillingCard title="Client Information" action={<AddClientNote />}>
            {body}
          </BillingCard>
          <BillingCard title="Estimate Details">{body}</BillingCard>
          <BillingCard title="Line Items">{body}</BillingCard>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <BillingCard title="Estimate Summary">{body}</BillingCard>
          <BillingCard title="Estimate Settings">{body}</BillingCard>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="outline" disabled>
          Save as Draft
        </Button>
        <Button variant="outline" disabled>
          <Eye aria-hidden weight="fill" className="size-5" />
          Preview Estimate
        </Button>
        <Button disabled>
          <PaperPlaneTilt aria-hidden weight="fill" className="size-5" />
          Send Estimate
        </Button>
      </div>
    </div>
  );
}

/** The client picker: every client of an active firm, grouped by firm (the firm is theirs). */
function ClientSelect({
  id,
  value,
  invalid,
  groups,
  onChange,
}: {
  id: string;
  value: string;
  invalid: boolean;
  groups: { firm: BillingFirm; clients: BillingClient[] }[];
  onChange: (clientId: string) => void;
}) {
  return (
    <div className="relative min-w-0">
      <select
        id={id}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`min-h-11 w-full min-w-0 appearance-none truncate rounded-control border bg-surface py-2 pr-10 pl-3 text-base ${compactText} text-text focus:outline-2 focus:outline-accent-500 disabled:bg-disabled ${invalid ? 'border-danger' : 'border-border'}`}
      >
        <option value="">Search or select a client...</option>
        {groups.map((group) => (
          <optgroup key={group.firm.id} label={group.firm.name}>
            {group.clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <CaretDown
        aria-hidden
        weight="bold"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-heading"
      />
    </div>
  );
}

/** A row of the Estimate Summary card. */
function SummaryRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 text-sm text-heading">
      {label}
      {children}
    </div>
  );
}

function EstimateForm({
  mode,
  settings,
  firms,
  clients,
  admins,
  estimate,
  suggestedNumber,
}: {
  mode: 'create' | 'edit';
  settings: BillingSettings;
  firms: BillingFirm[];
  clients: BillingClient[];
  admins: BillingAdmin[];
  estimate: BillingEstimate | null;
  suggestedNumber: string;
}) {
  const router = useRouter();
  const { me } = useMe();
  const [draft, setDraft] = useState<Draft>(() =>
    estimate
      ? draftOf(estimate)
      : blankDraft(
          settings,
          suggestedNumber,
          admins.find((admin) => admin.email.toLowerCase() === me.user.email.toLowerCase())?.id ??
            '',
        ),
  );
  // Edit keeps the saved terms; Create shows the client's firm's terms until they are edited.
  const [termsTouched, setTermsTouched] = useState(estimate !== null);
  const [baseline] = useState(() => signature(draft, termsTouched));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [lineErrors, setLineErrors] = useState<LineErrors[]>([]);
  const [preview, setPreview] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const client = clients.find((row) => row.id === draft.clientId) ?? null;
  const firm = client ? (firms.find((row) => row.id === client.firmId) ?? null) : null;
  const firmTerms = useApiQuery(['admin-billing', 'estimate-terms', firm?.id ?? 'platform'], () =>
    firm
      ? adminBilling.estimateTerms(firm.id)
      : Promise.resolve(settings.general.termsAndConditions),
  );
  const save = useApiMutation(
    (body: SaveEstimate) =>
      mode === 'edit' && estimate
        ? adminBilling.updateEstimate(estimate.id, body)
        : adminBilling.createEstimate(body),
    { invalidate: ['admin-billing'] },
  );

  const terms = termsTouched ? draft.terms : (firmTerms.data ?? draft.terms);
  const currency: Currency = firm?.currency ?? settings.general.currency;
  const symbol = SYMBOLS[currency];
  const rates = settings.taxes.rates;
  const taxPercent = rates.find((rate) => rate.id === draft.taxRateId)?.ratePercent ?? 0;
  const totals = computeTotals(
    draft.lines.map((line) => ({
      quantity: parseQuantity(line.quantity) || 0,
      rateCents: parseMoney(line.rate) ?? 0,
      taxPercent,
    })),
    parseMoney(draft.discount) ?? 0,
  );
  const groups = firms
    .filter((row) => row.status === 'ACTIVE' || row.id === client?.firmId)
    .map((row) => ({ firm: row, clients: clients.filter((c) => c.firmId === row.id) }))
    .filter((group) => group.clients.length > 0);
  const contacts = [...new Set([client?.contactName ?? '', draft.contactName].filter(Boolean))];
  const locked = estimate !== null && estimate.convertedInvoiceId !== null;
  const dirty = signature(draft, termsTouched) !== baseline;
  const backHref = estimate ? `/billing/estimates?estimate=${estimate.id}` : '/billing/estimates';
  const set = (patch: Partial<Draft>) => setDraft((now) => ({ ...now, ...patch }));
  const setLine = (key: string, patch: Partial<LineDraft>) =>
    setDraft((now) => ({
      ...now,
      lines: now.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    }));

  const previewData: EstimateDocumentData = {
    number: draft.number,
    issueDate: draft.issueDate,
    expirationDate: draft.expirationDate,
    reference: draft.reference,
    currency,
    contactName: draft.contactName,
    email: draft.email,
    phone: draft.phone,
    lines: draft.lines.map((line, index) => ({
      id: line.key,
      description: line.description,
      quantity: parseQuantity(line.quantity) || 0,
      rateCents: parseMoney(line.rate) ?? 0,
      amountCents: totals.lines[index]?.amountCents ?? 0,
    })),
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    taxPercent,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    notes: draft.notes,
    terms,
  };

  function pickClient(clientId: string) {
    const next = clients.find((row) => row.id === clientId);
    set({
      clientId,
      contactName: next?.contactName ?? '',
      email: next?.email ?? '',
      phone: next?.phone ?? '',
    });
  }

  function submit(send: boolean) {
    const body = bodyOf(draft, terms, send);
    const found = estimateErrors(body);
    setFieldErrors(found.fields);
    setLineErrors(found.lines);
    if (hasErrors(found)) return;
    const kind = send
      ? draft.sendNotification
        ? 'sent'
        : 'marked'
      : mode === 'edit'
        ? 'updated'
        : draft.status === 'DRAFT'
          ? 'draft'
          : 'saved';
    save.mutate(body, {
      onSuccess: (saved) => router.push(`/billing/estimates?estimate=${saved.id}&saved=${kind}`),
      onError: (error) => {
        if (errorCode(error) === 'DUPLICATE_NUMBER')
          setFieldErrors((now) => ({ ...now, number: BILLING_ERRORS['DUPLICATE_NUMBER'] }));
      },
    });
  }

  const saveLabel =
    draft.status === 'DRAFT' ? 'Save as Draft' : mode === 'edit' ? 'Save Changes' : 'Save Estimate';
  const sendLabel = estimate?.sentAt ? 'Save & Resend' : 'Send Estimate';
  const err = (key: string) => fieldErrors[key];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <BillingHeader
        title={TITLES[mode].title}
        subtitle={TITLES[mode].subtitle}
        breadcrumbs={crumbs(estimate)}
        actions={
          <BackLink
            href={backHref}
            onClick={(event) => {
              if (!dirty) return;
              event.preventDefault();
              setLeaving(true);
            }}
          />
        }
      />
      {locked && estimate ? (
        <p role="status" className="rounded-lg bg-disabled p-3 text-sm text-text">
          This estimate was converted to{' '}
          <Link
            href={`/billing/invoices/${estimate.convertedInvoiceId}`}
            className="font-medium text-action hover:underline"
          >
            {estimate.convertedInvoiceNumber ?? 'an invoice'}
          </Link>
          , so it can&apos;t be changed.
        </p>
      ) : null}
      {save.error ? (
        <p
          role="alert"
          data-testid="save-error"
          className="rounded-lg bg-danger-soft p-3 text-sm text-danger"
        >
          {errorMessage(save.error, BILLING_ERRORS)}
        </p>
      ) : null}

      <form
        noValidate
        aria-label={mode === 'edit' ? 'Edit estimate' : 'Create estimate'}
        onSubmit={(event) => event.preventDefault()}
        className="flex min-w-0 flex-col gap-6"
      >
        <fieldset disabled={locked} className="grid min-w-0 items-start gap-6 xl:grid-cols-3">
          <legend className="sr-only">Estimate</legend>
          <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
            <BillingCard title="Client Information" action={<AddClientNote />} testId="client-card">
              {/* Four fields in a row once the card is wide enough (container query): the
                  client takes the free room, the email a wide column, contact and phone less. */}
              <div className="@container">
                <div className="grid gap-4 @lg:grid-cols-2 @2xl:flex @2xl:gap-3">
                  <div className="min-w-0 @2xl:flex-1">
                    <FormField
                      label="Client"
                      htmlFor="estimate-client"
                      required
                      error={err('clientId')}
                    >
                      <ClientSelect
                        id="estimate-client"
                        value={draft.clientId}
                        invalid={Boolean(err('clientId'))}
                        groups={groups}
                        onChange={pickClient}
                      />
                    </FormField>
                  </div>
                  <div className="min-w-0 @2xl:w-36 @2xl:shrink-0">
                    <FormField label="Contact Person" htmlFor="estimate-contact">
                      <SelectControl
                        compact
                        id="estimate-contact"
                        value={draft.contactName}
                        placeholder="Select contact (optional)"
                        className="truncate"
                        options={contacts.map((name) => ({ value: name, label: name }))}
                        onChange={(event) => set({ contactName: event.target.value })}
                      />
                    </FormField>
                  </div>
                  <div className="min-w-0 @2xl:w-52 @2xl:shrink-0">
                    <FormField label="Email" htmlFor="estimate-email" error={err('email')}>
                      <input
                        id="estimate-email"
                        type="email"
                        maxLength={254}
                        value={draft.email}
                        placeholder="client@email.com"
                        aria-invalid={Boolean(err('email')) || undefined}
                        onChange={(event) => set({ email: event.target.value })}
                        className={inputClass(Boolean(err('email')), true)}
                      />
                    </FormField>
                  </div>
                  <div className="min-w-0 @2xl:w-36 @2xl:shrink-0">
                    <FormField label="Phone" htmlFor="estimate-phone">
                      <input
                        id="estimate-phone"
                        type="tel"
                        maxLength={30}
                        value={draft.phone}
                        placeholder="(   ) ___-____"
                        onChange={(event) => set({ phone: event.target.value })}
                        className={inputClass(false, true)}
                      />
                    </FormField>
                  </div>
                </div>
              </div>
            </BillingCard>

            <BillingCard title="Estimate Details" testId="details-card">
              {/* The number and the dates take fixed widths, the reference the rest. */}
              <div className="@container">
                <div className="grid gap-4 @lg:grid-cols-2 @2xl:flex @2xl:gap-3">
                  <div className="min-w-0 @2xl:w-36 @2xl:shrink-0">
                    <FormField label="Estimate #" htmlFor="estimate-number" error={err('number')}>
                      <div className="relative min-w-0">
                        <input
                          id="estimate-number"
                          value={draft.number}
                          maxLength={40}
                          aria-invalid={Boolean(err('number')) || undefined}
                          onChange={(event) => set({ number: event.target.value })}
                          className={`${inputClass(Boolean(err('number')), true)} ${mode === 'create' ? 'pr-11' : ''}`}
                        />
                        {mode === 'create' ? (
                          <button
                            type="button"
                            aria-label="Use the next number from Billing Settings"
                            title="Use the next number from Billing Settings"
                            onClick={() => set({ number: suggestedNumber })}
                            className="absolute top-1/2 right-1.5 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-heading hover:bg-canvas"
                          >
                            <GearSix aria-hidden weight="fill" className="size-5" />
                          </button>
                        ) : null}
                      </div>
                    </FormField>
                  </div>
                  <div className="min-w-0 @2xl:w-36 @2xl:shrink-0">
                    <FormField
                      label="Issue Date"
                      htmlFor="estimate-issue"
                      required
                      error={err('issueDate')}
                    >
                      <DateControl
                        compact
                        id="estimate-issue"
                        value={draft.issueDate}
                        invalid={Boolean(err('issueDate'))}
                        onChange={(event) => {
                          const issueDate = event.target.value;
                          // Keep the estimate's validity when the issue date moves.
                          const gap = gapDays(draft.issueDate, draft.expirationDate);
                          const days =
                            Number.isFinite(gap) && gap >= 0
                              ? gap
                              : settings.general.estimateValidityDays;
                          set({
                            issueDate,
                            ...(issueDate ? { expirationDate: addDays(issueDate, days) } : {}),
                          });
                        }}
                      />
                    </FormField>
                  </div>
                  <div className="min-w-0 @2xl:w-36 @2xl:shrink-0">
                    <FormField
                      label="Expiration Date"
                      htmlFor="estimate-expiry"
                      required
                      error={err('expirationDate')}
                    >
                      <DateControl
                        compact
                        id="estimate-expiry"
                        value={draft.expirationDate}
                        min={draft.issueDate || undefined}
                        invalid={Boolean(err('expirationDate'))}
                        onChange={(event) => set({ expirationDate: event.target.value })}
                      />
                    </FormField>
                  </div>
                  <div className="min-w-0 @2xl:flex-1">
                    <FormField label="Reference (Optional)" htmlFor="estimate-reference">
                      <input
                        id="estimate-reference"
                        maxLength={120}
                        value={draft.reference}
                        placeholder="e.g. Project, Service, Event"
                        onChange={(event) => set({ reference: event.target.value })}
                        className={inputClass(false, true)}
                      />
                    </FormField>
                  </div>
                </div>
              </div>
            </BillingCard>

            <BillingCard title="Line Items" testId="lines-card">
              <div className="flex flex-col gap-4">
                {err('lines') ? <p className="text-sm text-danger">{err('lines')}</p> : null}
                <div className="@container rounded-lg border border-divider">
                  <div
                    aria-hidden
                    className="hidden items-center gap-2 rounded-t-lg bg-table-head px-3 py-2.5 text-sm font-semibold text-heading @xl:flex"
                  >
                    <span className="w-6 shrink-0">#</span>
                    <span className="flex-1">
                      Description <span className="text-danger">*</span>
                    </span>
                    <span className="w-20 shrink-0">Qty</span>
                    <span className="w-28 shrink-0">Rate ({symbol})</span>
                    <span className="w-28 shrink-0">Amount ({symbol})</span>
                    <span className="w-10 shrink-0" />
                  </div>
                  <ul className="flex flex-col gap-3 p-3">
                    {draft.lines.map((line, index) => {
                      const errors = lineErrors[index] ?? {};
                      const messages = [errors.description, errors.quantity, errors.rate].filter(
                        Boolean,
                      );
                      const n = index + 1;
                      return (
                        <li
                          key={line.key}
                          data-testid="estimate-line"
                          className="flex flex-col gap-1"
                        >
                          <div className="grid grid-cols-12 items-center gap-2 @xl:flex">
                            <span className="col-span-1 text-sm text-heading @xl:w-6 @xl:shrink-0">
                              {n}
                            </span>
                            <input
                              aria-label={`Description, line ${n}`}
                              value={line.description}
                              maxLength={200}
                              placeholder="Enter description"
                              aria-invalid={Boolean(errors.description) || undefined}
                              onChange={(event) =>
                                setLine(line.key, { description: event.target.value })
                              }
                              className={`${inputClass(Boolean(errors.description), true)} col-span-9 @xl:flex-1`}
                            />
                            <input
                              aria-label={`Quantity, line ${n}`}
                              inputMode="decimal"
                              value={line.quantity}
                              placeholder="1"
                              aria-invalid={Boolean(errors.quantity) || undefined}
                              onChange={(event) =>
                                setLine(line.key, { quantity: event.target.value })
                              }
                              className={`${inputClass(Boolean(errors.quantity), true)} col-span-3 @xl:w-20 @xl:flex-none`}
                            />
                            <input
                              aria-label={`Rate, line ${n}`}
                              inputMode="decimal"
                              value={line.rate}
                              placeholder="0.00"
                              aria-invalid={Boolean(errors.rate) || undefined}
                              onChange={(event) => setLine(line.key, { rate: event.target.value })}
                              className={`${inputClass(Boolean(errors.rate), true)} col-span-4 @xl:w-28 @xl:flex-none`}
                            />
                            <span
                              data-testid="line-amount"
                              className={`col-span-5 flex min-h-11 min-w-0 items-center overflow-hidden rounded-control bg-canvas px-3 text-base ${compactText} text-muted @xl:w-28 @xl:flex-none`}
                            >
                              <span className="sr-only">Amount, line {n}: </span>
                              {plainAmount(totals.lines[index]?.amountCents ?? 0)}
                            </span>
                            <button
                              type="button"
                              aria-label={`Delete line ${n}`}
                              title="Delete line"
                              disabled={draft.lines.length === 1}
                              onClick={() =>
                                setDraft((now) => ({
                                  ...now,
                                  lines: now.lines.filter((row) => row.key !== line.key),
                                }))
                              }
                              className="col-span-2 col-start-11 row-start-1 inline-flex size-10 items-center justify-center justify-self-end rounded-lg text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:text-disabled-text @xl:shrink-0"
                            >
                              <Trash aria-hidden weight="fill" className="size-5" />
                            </button>
                          </div>
                          {messages.length ? (
                            <p className="text-xs text-danger">{messages.join(' · ')}</p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div>
                  <Button
                    variant="outline"
                    onClick={() => set({ lines: [...draft.lines, blankLine()] })}
                  >
                    <Plus aria-hidden weight="bold" className="size-5" />
                    Add Line Item
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    label="Notes"
                    htmlFor="estimate-notes"
                    error={err('notes')}
                    counter={`${draft.notes.length}/1000`}
                  >
                    <textarea
                      id="estimate-notes"
                      rows={4}
                      maxLength={1000}
                      value={draft.notes}
                      placeholder="Add any additional notes for your client..."
                      onChange={(event) => set({ notes: event.target.value })}
                      className={inputClass(Boolean(err('notes')), true)}
                    />
                  </FormField>
                  <FormField
                    label="Terms & Conditions"
                    htmlFor="estimate-terms"
                    error={err('terms')}
                    hint={
                      termsTouched
                        ? undefined
                        : firm
                          ? `${firm.name}'s estimate terms.`
                          : 'The platform default from Billing Settings.'
                    }
                  >
                    <textarea
                      id="estimate-terms"
                      rows={4}
                      maxLength={2000}
                      value={terms}
                      onChange={(event) => {
                        setTermsTouched(true);
                        set({ terms: event.target.value });
                      }}
                      className={inputClass(Boolean(err('terms')), true)}
                    />
                  </FormField>
                </div>
              </div>
            </BillingCard>
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <BillingCard title="Estimate Summary" testId="summary-card">
              <div className="flex flex-col gap-4">
                <SummaryRow label={<span>Subtotal</span>}>
                  <span data-testid="estimate-subtotal" className="font-semibold">
                    {formatMoney(totals.subtotalCents, currency)}
                  </span>
                </SummaryRow>
                <div className="flex flex-col gap-1">
                  <SummaryRow label={<label htmlFor="estimate-discount">Discount</label>}>
                    <div
                      className={`flex h-11 w-36 min-w-0 overflow-hidden rounded-control border bg-surface focus-within:outline-2 focus-within:outline-accent-500 ${err('discountCents') ? 'border-danger' : 'border-border'}`}
                    >
                      <span
                        aria-hidden
                        className="flex items-center border-r border-border bg-canvas px-3 text-heading"
                      >
                        {symbol}
                      </span>
                      <input
                        id="estimate-discount"
                        inputMode="decimal"
                        value={draft.discount}
                        placeholder="0.00"
                        aria-invalid={Boolean(err('discountCents')) || undefined}
                        onChange={(event) => set({ discount: event.target.value })}
                        className="w-full min-w-0 bg-transparent px-3 text-sm text-text outline-none placeholder:text-muted"
                      />
                    </div>
                  </SummaryRow>
                  {err('discountCents') ? (
                    <p className="text-right text-xs text-danger">{err('discountCents')}</p>
                  ) : null}
                </div>
                <SummaryRow label={<label htmlFor="estimate-tax">Tax</label>}>
                  <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
                    <div className="w-full max-w-40 min-w-0">
                      <SelectControl
                        compact
                        id="estimate-tax"
                        value={draft.taxRateId}
                        options={[
                          { value: '', label: 'No Tax' },
                          ...rates.map((rate) => ({
                            value: rate.id,
                            label: `${rate.name} (${rate.ratePercent}%)`,
                          })),
                        ]}
                        onChange={(event) => set({ taxRateId: event.target.value })}
                      />
                    </div>
                    <span data-testid="estimate-tax-amount" className="shrink-0 font-semibold">
                      {formatMoney(totals.taxCents, currency)}
                    </span>
                  </div>
                </SummaryRow>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-4">
                  <span className="text-lg font-bold text-heading">Total ({currency})</span>
                  <span data-testid="estimate-total" className="text-3xl font-bold text-heading">
                    {formatMoney(totals.totalCents, currency)}
                  </span>
                </div>
              </div>
            </BillingCard>

            <BillingCard title="Estimate Settings" testId="settings-card">
              <div className="flex flex-col gap-4">
                <FormField label="Status" htmlFor="estimate-status">
                  <SelectControl
                    compact
                    id="estimate-status"
                    value={draft.status}
                    options={SETTABLE_STATUSES.map((value) => ({
                      value,
                      label: ESTIMATE_STATUS_LABELS[value],
                    }))}
                    onChange={(event) => set({ status: event.target.value as EstimateSetStatus })}
                  />
                </FormField>
                <fieldset className="flex flex-col">
                  <legend className="text-sm font-medium text-text">Send Notification</legend>
                  <Checkbox
                    label="Email estimate to client after saving"
                    checked={draft.sendNotification}
                    onChange={(event) => set({ sendNotification: event.target.checked })}
                  />
                </fieldset>
                <FormField label="Template" htmlFor="estimate-template">
                  <SelectControl
                    compact
                    id="estimate-template"
                    value={draft.template}
                    options={optionsOf(ESTIMATE_TEMPLATES, ESTIMATE_TEMPLATE_LABELS)}
                    onChange={(event) => set({ template: event.target.value as EstimateTemplate })}
                  />
                </FormField>
                <FormField label="Assign To (Optional)" htmlFor="estimate-assignee">
                  <SelectControl
                    compact
                    id="estimate-assignee"
                    value={draft.assignedToId}
                    placeholder="Unassigned"
                    options={admins.map((admin) => ({ value: admin.id, label: admin.name }))}
                    onChange={(event) => set({ assignedToId: event.target.value })}
                  />
                </FormField>
                <Callout icon={Info} title="Next Steps" size="compact">
                  <p className="text-muted">
                    You can preview the estimate before sending. Once the client approves it, you
                    can convert it to an invoice.
                  </p>
                </Callout>
              </div>
            </BillingCard>
          </div>
        </fieldset>

        <div className="flex flex-wrap justify-end gap-3">
          <Button
            variant="outline"
            disabled={save.isPending || locked}
            onClick={() => submit(false)}
          >
            {saveLabel}
          </Button>
          <Button variant="outline" onClick={() => setPreview(true)}>
            <Eye aria-hidden weight="fill" className="size-5" />
            Preview Estimate
          </Button>
          <Button disabled={save.isPending || locked} onClick={() => submit(true)}>
            <PaperPlaneTilt aria-hidden weight="fill" className="size-5" />
            {save.isPending ? 'Saving…' : sendLabel}
          </Button>
        </div>
      </form>

      <DocumentViewer
        open={preview}
        title={`Estimate ${draft.number || 'preview'}`}
        onClose={() => setPreview(false)}
      >
        <EstimateDocument data={previewData} firm={firm} client={client} />
      </DocumentViewer>

      <Modal
        open={leaving}
        title="Discard changes?"
        onClose={() => setLeaving(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLeaving(false)}>
              Keep Editing
            </Button>
            <Button onClick={() => router.push(backHref)}>Discard Changes</Button>
          </>
        }
      >
        <p className="text-sm text-text">Your changes to this estimate have not been saved.</p>
      </Modal>
    </div>
  );
}
