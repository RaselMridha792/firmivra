'use client';

import {
  type BookkeepingTerms,
  type BookkeepingTermsNoticeRequest,
  BookkeepingBillingFrequency,
  BookkeepingPaymentTerms,
  DOCUMENT_ERRORS,
  UPLOAD_LIMITS,
} from '@firmivra/types';
import {
  Badge,
  Button,
  Checkbox,
  type Column,
  FileDropzone,
  Input,
  Modal,
  Select,
  Table,
  Textarea,
  Toast,
  Toggle,
} from '@firmivra/ui';
import {
  CheckCircle,
  ClockCounterClockwise,
  CreditCard,
  CurrencyDollar,
  DownloadSimple,
  FileText,
  Lightning,
  Note,
  PaperPlaneTilt,
  Plus,
  Prohibit,
  SealCheck,
  Stack,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { OriginLink } from '../../../../../components/origin-link';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { uploadFile } from '../../../../../lib/upload';
import {
  BK_KEY,
  card,
  dayText,
  dateTimeText,
  linkBtn,
  money,
  outlined,
  primary,
  quiet,
  SoftwareTile,
  StatusPill,
} from './bookkeeping-shared';
import {
  changedFields,
  eventText,
  FREQUENCY,
  PAYMENT_TERMS,
  paymentTermsText,
  RENEWAL,
  TERMS_STATUS,
  TERMS_TABS,
  type TermsTab,
} from './terms-parts';

const KEY = (id: string) => [...BK_KEY, 'terms', id];
const managerRole = (role: string | undefined) => role === 'OWNER' || role === 'ADMIN';
const TERMS_ERRORS: Record<string, string> = {
  TERMS_DRAFT_EXISTS: 'A draft is already open for this client.',
  AGREEMENT_NOT_SIGNED: 'The agreement is not signed yet. Upload the signed copy first.',
};
const termsError = (e: unknown) => errorMessage(e, { ...TERMS_ERRORS, ...DOCUMENT_ERRORS });

type Notice = (text: string, tone?: 'success' | 'error') => void;

function Section({
  title,
  icon: Glyph,
  subtitle,
  children,
  testId,
  aside,
}: {
  title: string;
  icon: typeof FileText;
  subtitle?: string;
  children: ReactNode;
  testId?: string;
  aside?: ReactNode;
}) {
  return (
    <section className={card} aria-label={title} data-testid={testId}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Glyph aria-hidden weight="fill" className="mt-0.5 size-5 text-action" />
          <div>
            <h2 className="font-display text-lg font-bold text-heading">{title}</h2>
            {subtitle ? <p className="text-xs text-muted">{subtitle}</p> : null}
          </div>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * /bookkeeping/clients/[id]/terms (Octavia's BK-E01; design
 * `bookkeeping-close-reconciliation-and-report-review.jpg`): the six Terms areas on R55's Terms
 * API. A draft is edited here; terms in force change only through a new version, so a signed
 * version is never overwritten. Owners and Admins create, send, activate, terminate and record
 * notices (the API checks).
 */
export function TermsScreen({ id, initialTab }: { id: string; initialTab: TermsTab }) {
  const [tab, setTab] = useState<TermsTab>(initialTab);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const notice: Notice = (text, tone = 'success') => setMessage({ text, tone });
  const { role } = useFirm();
  const manager = managerRole(role);
  const qc = useQueryClient();
  const ws = useApiQuery([...BK_KEY, 'client', id], () => api.bookkeeping.getClient(id));
  const page = useApiQuery(KEY(id), () => api.bookkeepingTerms.page(id));
  const w = ws.data;
  const p = page.data;
  const working = p?.draft ?? p?.current ?? null;
  const refresh = () => qc.invalidateQueries({ queryKey: KEY(id) });
  const act = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      await refresh();
      notice(done);
      return true;
    } catch (e) {
      notice(termsError(e), 'error');
      return false;
    }
  };
  const changeTab = (next: TermsTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'terms') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', url);
  };
  const sw = w?.connections.find((k) => k.status !== 'DISCONNECTED');

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="bk-terms">
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-link">
        <Link href="/bookkeeping">Bookkeeping</Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <Link href="/bookkeeping">Clients</Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <Link href={`/bookkeeping/clients/${id}`}>{w?.client.displayName ?? 'Client'}</Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span aria-current="page" className="font-medium text-heading">
          Terms
        </span>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex size-16 items-center justify-center rounded-xl bg-action text-on-action">
            <FileText aria-hidden weight="fill" className="size-9" />
          </span>
          <div>
            <h1 data-testid="page-title" className="font-display text-3xl font-bold text-heading">
              Terms
            </h1>
            <p className="text-action">
              Set and manage bookkeeping terms, fees, payment schedules, and engagement details.
            </p>
          </div>
        </div>
        {w ? (
          <div className="flex items-center gap-3 rounded-xl bg-surface p-4 shadow-md">
            <SoftwareTile
              provider={sw?.provider ?? null}
              label={sw?.label ?? w.client.displayName}
              size="md"
            />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-heading">
                {w.client.displayName} <StatusPill status={w.status} />
              </p>
              <p className="text-sm text-text">
                {w.plan ?? 'No plan'} · Client since {dayText(w.clientSince.slice(0, 10))}
              </p>
            </div>
          </div>
        ) : null}
      </header>

      <div
        role="tablist"
        aria-label="Terms areas"
        className="flex overflow-x-auto border-b border-divider"
      >
        {TERMS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => changeTab(t.id)}
            className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm whitespace-nowrap ${tab === t.id ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {page.isPending ? (
        <p className={quiet}>Loading…</p>
      ) : page.isError ? (
        <p role="alert" className={quiet}>
          The terms could not be loaded. Try again in a moment.
        </p>
      ) : !working ? (
        <section className={card} data-testid="no-terms">
          <p className="mb-3 text-sm text-text">
            No terms are set up for {w?.client.displayName ?? 'this client'} yet.
          </p>
          {manager ? (
            <button
              type="button"
              className={primary}
              onClick={() =>
                void act(() => api.bookkeepingTerms.create(id, {}), 'Draft terms created.')
              }
            >
              <Plus aria-hidden weight="bold" className="size-4" /> Create Terms
            </button>
          ) : (
            <p className="text-xs text-muted">An Owner or Admin sets up a client&apos;s terms.</p>
          )}
        </section>
      ) : (
        <>
          <VersionBar
            current={p!.current}
            draft={p!.draft}
            manager={manager}
            onNewVersion={() =>
              void act(() => api.bookkeepingTerms.create(id, {}), 'A new draft version is open.')
            }
          />
          {tab === 'terms' ? (
            <TermsTabView
              key={working.id + working.updatedAt}
              t={working}
              clientId={id}
              act={act}
              manager={manager}
              engagementId={w?.engagementId}
              firmClientId={w?.client.id}
              clientName={w?.client.displayName ?? ''}
            />
          ) : null}
          {tab === 'service' ? (
            <ServiceTab key={working.id + working.updatedAt} t={working} act={act} />
          ) : null}
          {tab === 'billing' ? <BillingTab t={working} clientId={id} /> : null}
          {tab === 'documents' ? (
            <DocumentsTab t={working} act={act} engagementId={w?.engagementId} manager={manager} />
          ) : null}
          {tab === 'renewal' ? (
            <RenewalTab t={p!.current ?? working} act={act} manager={manager} />
          ) : null}
          {tab === 'history' ? <HistoryTab clientId={id} versions={p!.versions} /> : null}
        </>
      )}
    </div>
  );
}

function VersionBar({
  current,
  draft,
  manager,
  onNewVersion,
}: {
  current: BookkeepingTerms | null;
  draft: BookkeepingTerms | null;
  manager: boolean;
  onNewVersion: () => void;
}) {
  const shown = draft ?? current!;
  const status = TERMS_STATUS[shown.status];
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-xl bg-surface px-4 py-3 text-sm shadow-md"
      data-testid="terms-version"
    >
      <span className="font-semibold text-heading">Version {shown.version}</span>
      <Badge tone={status.tone}>{status.label}</Badge>
      <span className="text-muted">Effective {dayText(shown.effectiveFrom)}</span>
      {draft && current ? (
        <span className="text-muted">
          Version {current.version} stays in force until this one is activated.
        </span>
      ) : null}
      {!draft && current && manager && current.can.newVersion ? (
        <button type="button" className={`${outlined} ml-auto min-h-9`} onClick={onNewVersion}>
          <Plus aria-hidden weight="bold" className="size-4" /> New Version
        </button>
      ) : null}
      {!draft && current ? (
        <span className="text-xs text-muted">
          Terms in force change only through a new version; the signed version stays as it was.
        </span>
      ) : null}
    </div>
  );
}

type Act = (work: () => Promise<unknown>, done: string) => Promise<boolean>;

/** A list of lines (included services, exclusions, responsibilities): edited on a draft only. */
function Lines({
  items,
  onChange,
  editable,
  label,
  checked,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  editable: boolean;
  label: string;
  /** Included: a ticked box; excluded: an empty one, as the design draws them. */
  checked: boolean;
}) {
  const [adding, setAdding] = useState('');
  return (
    <div className="flex flex-col gap-1.5">
      {items.length === 0 ? <p className="text-sm text-muted">None listed.</p> : null}
      {items.map((line, i) => (
        <div key={`${i}-${line}`} className="flex items-center gap-2 text-sm text-text">
          <span
            aria-hidden
            className={`flex size-4 shrink-0 items-center justify-center rounded-sm border ${checked ? 'border-action bg-action text-on-action' : 'border-border bg-surface'}`}
          >
            {checked ? <CheckCircle weight="fill" className="size-3" /> : null}
          </span>
          <span className="min-w-0 flex-1">{line}</span>
          {editable ? (
            <button
              type="button"
              aria-label={`Remove ${line}`}
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="text-danger"
            >
              <Trash aria-hidden weight="bold" className="size-4" />
            </button>
          ) : null}
        </div>
      ))}
      {editable ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!adding.trim()) return;
            onChange([...items, adding.trim()]);
            setAdding('');
          }}
        >
          <Input
            label={label}
            value={adding}
            maxLength={200}
            onChange={(e) => setAdding(e.target.value)}
          />
          <Button type="submit" variant="secondary" disabled={!adding.trim()}>
            Add
          </Button>
        </form>
      ) : null}
    </div>
  );
}

type Draft = Pick<
  BookkeepingTerms,
  | 'packageName'
  | 'startDate'
  | 'endDate'
  | 'renewalType'
  | 'billingFrequency'
  | 'paymentTerms'
  | 'paymentTermsDays'
  | 'preferredPaymentMethod'
  | 'autopay'
  | 'monthlyFeeCents'
  | 'setupFeeCents'
  | 'lateFeeRule'
  | 'includedServices'
  | 'excludedServices'
  | 'internalNotes'
>;
const draftOf = (t: BookkeepingTerms): Draft => ({
  packageName: t.packageName,
  startDate: t.startDate,
  endDate: t.endDate,
  renewalType: t.renewalType,
  billingFrequency: t.billingFrequency,
  paymentTerms: t.paymentTerms,
  paymentTermsDays: t.paymentTermsDays,
  preferredPaymentMethod: t.preferredPaymentMethod,
  autopay: t.autopay,
  monthlyFeeCents: t.monthlyFeeCents,
  setupFeeCents: t.setupFeeCents,
  lateFeeRule: t.lateFeeRule,
  includedServices: t.includedServices,
  excludedServices: t.excludedServices,
  internalNotes: t.internalNotes,
});
const dollars = (cents: number) => (cents / 100).toFixed(2);
const cents = (text: string) => Math.max(0, Math.round(Number(text || '0') * 100));

/** The Terms area: package, billing, pricing, included and excluded services, the schedule. */
function TermsTabView({
  t,
  clientId,
  act,
  manager,
  engagementId,
  firmClientId,
  clientName,
}: {
  t: BookkeepingTerms;
  clientId: string;
  act: Act;
  manager: boolean;
  engagementId: string | undefined;
  /** The firm's client record (the documents API's client), not the bookkeeping client. */
  firmClientId: string | undefined;
  clientName: string;
}) {
  const editable = t.can.edit;
  const [f, setF] = useState<Draft>(() => draftOf(t));
  const changes = changedFields(draftOf(t), f);
  const dirty = Object.keys(changes).length > 0;
  const [uploading, setUploading] = useState(false);
  const save = () => void act(() => api.bookkeepingTerms.update(t.id, changes), 'Terms saved.');
  return (
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        {!editable ? (
          <p className="text-sm text-muted" data-testid="terms-read-only">
            {t.status === 'SENT'
              ? 'These terms were sent to the client. Back to Draft to change them.'
              : 'These terms are in force. Start a New Version to change them.'}
          </p>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-3">
          <Section title="Service Package" icon={Stack} testId="terms-package">
            <div className="flex flex-col gap-3">
              <Input
                label="Package"
                value={f.packageName ?? ''}
                disabled={!editable}
                maxLength={120}
                onChange={(e) => setF({ ...f, packageName: e.target.value || null })}
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="Start Date"
                  type="date"
                  value={f.startDate}
                  disabled={!editable}
                  onChange={(e) => setF({ ...f, startDate: e.target.value })}
                />
                <Input
                  label="Agreement End Date"
                  type="date"
                  value={f.endDate ?? ''}
                  disabled={!editable}
                  onChange={(e) => setF({ ...f, endDate: e.target.value || null })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-heading">
                <Toggle
                  label="Auto-Renew"
                  checked={f.renewalType === 'AUTO'}
                  disabled={!editable}
                  onChange={(on) => setF({ ...f, renewalType: on ? 'AUTO' : 'MANUAL' })}
                />
                Auto-Renew
              </label>
            </div>
          </Section>
          <Section title="Billing Terms" icon={CreditCard} testId="terms-billing">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Select
                  label="Billing Frequency"
                  value={f.billingFrequency}
                  disabled={!editable}
                  onChange={(e) =>
                    setF({
                      ...f,
                      billingFrequency: BookkeepingBillingFrequency.parse(e.target.value),
                    })
                  }
                  options={Object.entries(FREQUENCY).map(([value, label]) => ({ value, label }))}
                />
                <Select
                  label="Payment Due"
                  value={f.paymentTerms}
                  disabled={!editable}
                  onChange={(e) => {
                    const next = BookkeepingPaymentTerms.parse(e.target.value);
                    setF({
                      ...f,
                      paymentTerms: next,
                      paymentTermsDays: next === 'CUSTOM' ? 30 : null,
                    });
                  }}
                  options={Object.entries(PAYMENT_TERMS).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </div>
              {f.paymentTerms === 'CUSTOM' ? (
                <Input
                  label="Due after (days)"
                  type="number"
                  min={1}
                  max={365}
                  value={String(f.paymentTermsDays ?? '')}
                  disabled={!editable}
                  onChange={(e) => setF({ ...f, paymentTermsDays: Number(e.target.value) || null })}
                />
              ) : null}
              <Input
                label="Preferred Payment Method"
                value={f.preferredPaymentMethod ?? ''}
                maxLength={60}
                disabled={!editable}
                onChange={(e) => setF({ ...f, preferredPaymentMethod: e.target.value || null })}
              />
              <label className="flex items-center gap-2 text-sm font-medium text-heading">
                <Toggle
                  label="Autopay"
                  checked={f.autopay}
                  disabled={!editable}
                  onChange={(on) => setF({ ...f, autopay: on })}
                />
                Autopay (needs the client&apos;s payment authorization)
              </label>
            </div>
          </Section>
          <Section title="Pricing" icon={CurrencyDollar} testId="terms-pricing">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="Monthly Fee ($)"
                  type="number"
                  min={0}
                  step="0.01"
                  value={dollars(f.monthlyFeeCents)}
                  disabled={!editable}
                  onChange={(e) => setF({ ...f, monthlyFeeCents: cents(e.target.value) })}
                />
                <Input
                  label="One-Time Setup Fee ($)"
                  type="number"
                  min={0}
                  step="0.01"
                  value={dollars(f.setupFeeCents)}
                  disabled={!editable}
                  onChange={(e) => setF({ ...f, setupFeeCents: cents(e.target.value) })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-heading">
                <Toggle
                  label="Apply Late Fee"
                  checked={!!f.lateFeeRule}
                  disabled={!editable}
                  onChange={(on) =>
                    setF({ ...f, lateFeeRule: on ? { amountCents: 2500, afterDays: 7 } : null })
                  }
                />
                Apply Late Fee
              </label>
              {f.lateFeeRule ? (
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    label="Late Fee Amount ($)"
                    type="number"
                    min={0}
                    step="0.01"
                    value={dollars(f.lateFeeRule.amountCents)}
                    disabled={!editable}
                    onChange={(e) =>
                      setF({
                        ...f,
                        lateFeeRule: { ...f.lateFeeRule!, amountCents: cents(e.target.value) },
                      })
                    }
                  />
                  <Input
                    label="After (Days)"
                    type="number"
                    min={1}
                    max={365}
                    value={String(f.lateFeeRule.afterDays)}
                    disabled={!editable}
                    onChange={(e) =>
                      setF({
                        ...f,
                        lateFeeRule: { ...f.lateFeeRule!, afterDays: Number(e.target.value) || 1 },
                      })
                    }
                  />
                </div>
              ) : null}
            </div>
          </Section>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Section
            title="Included Services"
            icon={SealCheck}
            subtitle="Define what is included in this client's bookkeeping package."
            testId="terms-included"
          >
            <Lines
              items={f.includedServices}
              onChange={(includedServices) => setF({ ...f, includedServices })}
              editable={editable}
              label="Add an included service"
              checked
            />
          </Section>
          <Section
            title="Exclusions / Not Included"
            icon={Prohibit}
            subtitle="Define what is not included in this package."
            testId="terms-excluded"
          >
            <Lines
              items={f.excludedServices}
              onChange={(excludedServices) => setF({ ...f, excludedServices })}
              editable={editable}
              label="Add an exclusion"
              checked={false}
            />
          </Section>
        </div>
        {editable ? (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={!dirty} onClick={() => setF(draftOf(t))}>
              Discard Changes
            </Button>
            <Button disabled={!dirty} onClick={save}>
              Save Changes
            </Button>
          </div>
        ) : null}
        <PaymentSchedule clientId={clientId} limit={5} />
      </div>
      <aside className="flex min-w-0 flex-col gap-4">
        <Section title="Quick Actions" icon={Lightning} testId="terms-actions">
          <div className="flex flex-col gap-2">
            {manager && engagementId && firmClientId ? (
              <button type="button" className={outlined} onClick={() => setUploading(true)}>
                <UploadSimple aria-hidden weight="bold" className="size-4" /> Upload Signed
                Agreement
              </button>
            ) : null}
            {manager && t.can.send ? (
              <button
                type="button"
                className={outlined}
                disabled={dirty}
                title={dirty ? 'Save the changes first' : undefined}
                onClick={() =>
                  void act(() => api.bookkeepingTerms.send(t.id, {}), 'Terms sent to the client.')
                }
              >
                <PaperPlaneTilt aria-hidden weight="fill" className="size-4" /> Send Terms to Client
              </button>
            ) : null}
            {manager && t.can.backToDraft ? (
              <button
                type="button"
                className={outlined}
                onClick={() =>
                  void act(() => api.bookkeepingTerms.backToDraft(t.id), 'Back to draft.')
                }
              >
                Back to Draft
              </button>
            ) : null}
            {manager && t.can.activate ? (
              <button
                type="button"
                className={outlined}
                disabled={dirty}
                onClick={() =>
                  void act(
                    () => api.bookkeepingTerms.activate(t.id, {}),
                    'These terms are in force.',
                  )
                }
              >
                <CheckCircle aria-hidden weight="fill" className="size-4" /> Activate Terms
              </button>
            ) : null}
            <DownloadAgreement t={t} />
            {!manager ? (
              <p className="text-xs text-muted">An Owner or Admin sends and activates terms.</p>
            ) : null}
          </div>
        </Section>
        <AgreementPreview t={{ ...t, ...f }} clientName={clientName} />
        <Section
          title="Notes"
          icon={Note}
          subtitle="Internal notes about this client's terms. Owners and Admins only."
          testId="terms-notes"
        >
          {!manager ? (
            <p className="text-sm text-muted">Only Owners and Admins see these notes.</p>
          ) : editable ? (
            <Textarea
              label="Internal note"
              rows={3}
              maxLength={5000}
              value={f.internalNotes ?? ''}
              onChange={(e) => setF({ ...f, internalNotes: e.target.value || null })}
            />
          ) : (
            <p className="text-sm whitespace-pre-wrap text-text">
              {t.internalNotes ?? 'No notes on this version.'}
            </p>
          )}
        </Section>
      </aside>
      {uploading && engagementId && firmClientId ? (
        <UploadSigned
          t={t}
          firmClientId={firmClientId}
          engagementId={engagementId}
          onClose={() => setUploading(false)}
          act={act}
        />
      ) : null}
    </div>
  );
}

function DownloadAgreement({ t }: { t: BookkeepingTerms }) {
  const file = t.documents.signedAgreement ?? t.documents.agreement;
  if (!file) {
    return <p className="text-xs text-muted">No agreement file is attached to this version yet.</p>;
  }
  return (
    <button
      type="button"
      className={outlined}
      onClick={() =>
        void api.documents.download(file.id).then((link) => window.location.assign(link.url))
      }
    >
      <DownloadSimple aria-hidden weight="bold" className="size-4" /> Download {file.name}
    </button>
  );
}

/** Upload Signed Agreement: the client's document (their engagement), then linked and signed. */
function UploadSigned({
  t,
  firmClientId,
  engagementId,
  onClose,
  act,
}: {
  t: BookkeepingTerms;
  firmClientId: string;
  engagementId: string;
  onClose: () => void;
  act: Act;
}) {
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Modal
      open
      title="Upload Signed Agreement"
      subtitle={`Version ${t.version}: the signed copy is kept with the client's documents.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!file || busy}
            onClick={async () => {
              if (!file) return;
              setBusy(true);
              setError(undefined);
              try {
                const doc = await uploadFile(file, {
                  start: (facts) =>
                    api.documents.createUpload(firmClientId, {
                      serviceId: engagementId,
                      shareWithClient: false,
                      ...facts,
                    }),
                  finish: (uploadToken) => api.documents.confirmUpload({ uploadToken }),
                  maxBytes: UPLOAD_LIMITS.maxBytes,
                });
                const ok = await act(
                  () =>
                    api.bookkeepingTerms.setAgreement(t.id, {
                      signedAgreementDocumentId: doc.id,
                      signed: true,
                    }),
                  'Signed agreement saved.',
                );
                if (ok) onClose();
              } catch (e) {
                setError(termsError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Uploading…' : 'Upload'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="upload-signed">
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <FileDropzone
          label="Signed agreement"
          multiple={false}
          maxBytes={UPLOAD_LIMITS.maxBytes}
          onFiles={(files) => setFile(files[0])}
          onReject={() => setError('Use a PDF or image file within the size limit.')}
          hints={[file ? `Chosen: ${file.name}` : 'The signed PDF or a scan of it']}
        />
      </div>
    </Modal>
  );
}

function AgreementPreview({ t, clientName }: { t: BookkeepingTerms; clientName: string }) {
  return (
    <Section title="Agreement Preview" icon={FileText} testId="terms-preview">
      <div className="rounded-lg border border-divider p-4 text-xs text-text">
        <p className="mb-3 text-center font-display text-sm font-bold text-heading">
          BOOKKEEPING SERVICES AGREEMENT
        </p>
        <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-y-1">
          <dt className="font-semibold text-heading">Client:</dt>
          <dd>{clientName || '—'}</dd>
          <dt className="font-semibold text-heading">Effective Date:</dt>
          <dd>{dayText(t.effectiveFrom)}</dd>
          <dt className="font-semibold text-heading">Service Package:</dt>
          <dd>{t.packageName ?? '—'}</dd>
          <dt className="font-semibold text-heading">Monthly Fee:</dt>
          <dd>{money(t.monthlyFeeCents)}</dd>
          <dt className="font-semibold text-heading">Billing Frequency:</dt>
          <dd>
            {FREQUENCY[t.billingFrequency]} ({paymentTermsText(t)})
          </dd>
        </dl>
        <ol className="mt-3 list-decimal pl-5">
          <li>Services Included</li>
          <li>Exclusions</li>
          <li>Payment Terms</li>
          <li>Term &amp; Renewal</li>
          <li>Client Responsibilities</li>
          <li>Termination</li>
        </ol>
        <div className="mt-6 grid grid-cols-2 gap-4">
          <p className="border-t border-divider pt-1">
            Client Signature
            {t.documents.signedAt ? ` · signed ${dayText(t.documents.signedAt.slice(0, 10))}` : ''}
          </p>
          <p className="border-t border-divider pt-1">Date</p>
        </div>
      </div>
    </Section>
  );
}

function PaymentSchedule({ clientId, limit }: { clientId: string; limit: number }) {
  const schedule = useApiQuery([...KEY(clientId), 'schedule', limit], () =>
    api.bookkeepingTerms.paymentSchedule(clientId, { pageSize: limit }),
  );
  type Row = NonNullable<typeof schedule.data>['items'][number];
  const columns: Column<Row>[] = [
    { id: 'number', label: 'Invoice #', cell: (r) => r.number },
    { id: 'period', label: 'Period', cell: (r) => r.period },
    { id: 'issued', label: 'Issue Date', cell: (r) => (r.issuedOn ? dayText(r.issuedOn) : '—') },
    { id: 'due', label: 'Due Date', cell: (r) => (r.dueOn ? dayText(r.dueOn) : '—') },
    { id: 'amount', label: 'Amount', cell: (r) => money(r.amountCents) },
    {
      id: 'status',
      label: 'Status',
      cell: (r) => (
        <Badge tone={r.status === 'PAID' ? 'success' : r.status === 'OPEN' ? 'warning' : 'neutral'}>
          {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
        </Badge>
      ),
    },
  ];
  return (
    <Section
      title="Payment Schedule"
      icon={ClockCounterClockwise}
      subtitle="Upcoming and past invoices based on the agreed terms, from Invoices & Payments."
      testId="terms-schedule"
      aside={
        <OriginLink href="/invoices" className={linkBtn}>
          View All
        </OriginLink>
      }
    >
      <Table
        rows={schedule.data?.items ?? []}
        columns={columns}
        rowKey={(r) => r.invoiceId}
        caption="Payment schedule"
        dense
        noun="invoices"
        pageSize={limit}
        showPagination={false}
        loading={schedule.isPending}
        keepHeaderWhenEmpty
        emptyTitle={schedule.isError ? 'The invoices are not available' : 'No invoices yet'}
        emptyText={
          schedule.isError
            ? 'We could not load them. Try again in a moment.'
            : 'Invoices for this engagement appear here once Invoices & Payments issues them.'
        }
      />
    </Section>
  );
}

/** Service Details: scope, add-ons, deliverables and both sides' responsibilities. */
function ServiceTab({ t, act }: { t: BookkeepingTerms; act: Act }) {
  const editable = t.can.edit;
  const [client, setClient] = useState(t.clientResponsibilities);
  const [firm, setFirm] = useState(t.firmResponsibilities);
  const dirty =
    JSON.stringify(client) !== JSON.stringify(t.clientResponsibilities) ||
    JSON.stringify(firm) !== JSON.stringify(t.firmResponsibilities);
  return (
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2" data-testid="terms-service">
      <Section title="Included Services" icon={SealCheck}>
        <Lines
          items={t.includedServices}
          onChange={() => undefined}
          editable={false}
          label=""
          checked
        />
      </Section>
      <Section title="Exclusions / Not Included" icon={Prohibit}>
        <Lines
          items={t.excludedServices}
          onChange={() => undefined}
          editable={false}
          label=""
          checked={false}
        />
      </Section>
      <Section title="Add-ons" icon={Plus}>
        {t.addOns.length === 0 ? (
          <p className="text-sm text-muted">No add-ons in these terms.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-text">
            {t.addOns.map((a) => (
              <li key={a.name}>
                {a.name}
                {a.feeCents !== null && a.feeCents !== undefined ? ` · ${money(a.feeCents)}` : ''}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Deliverables" icon={FileText}>
        {t.deliverables.length === 0 ? (
          <p className="text-sm text-muted">No deliverables listed.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-text">
            {t.deliverables.map((d) => (
              <li key={d.label}>
                {d.label}
                {d.frequency ? ` · ${d.frequency}` : ''}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Client Responsibilities" icon={CheckCircle}>
        <Lines
          items={client}
          onChange={setClient}
          editable={editable}
          label="Add a client responsibility"
          checked
        />
      </Section>
      <Section title="Firm Responsibilities" icon={CheckCircle}>
        <Lines
          items={firm}
          onChange={setFirm}
          editable={editable}
          label="Add a firm responsibility"
          checked
        />
      </Section>
      {editable ? (
        <div className="flex justify-end lg:col-span-2">
          <Button
            disabled={!dirty}
            onClick={() =>
              void act(
                () =>
                  api.bookkeepingTerms.update(t.id, {
                    clientResponsibilities: client,
                    firmResponsibilities: firm,
                  }),
                'Service details saved.',
              )
            }
          >
            Save Changes
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Billing & Payments: how and when the client pays, and the full schedule. */
function BillingTab({ t, clientId }: { t: BookkeepingTerms; clientId: string }) {
  const rows: [string, string][] = [
    ['Billing frequency', FREQUENCY[t.billingFrequency]],
    ['Billed', t.billingTiming === 'ADVANCE' ? 'In advance' : 'In arrears'],
    ['Payment due', paymentTermsText(t)],
    ['Preferred payment method', t.preferredPaymentMethod ?? 'Not set'],
    ['Autopay', t.autopay ? 'On (with the client’s payment authorization)' : 'Off'],
    ['Monthly fee', money(t.monthlyFeeCents)],
    ['One-time setup fee', money(t.setupFeeCents)],
    [
      'Late fee',
      t.lateFeeRule
        ? `${money(t.lateFeeRule.amountCents)} after ${t.lateFeeRule.afterDays} days`
        : 'None',
    ],
  ];
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="terms-billing-tab">
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Billing & Payments" icon={CreditCard}>
          <dl className="grid grid-cols-[11rem_minmax(0,1fr)] gap-y-1.5 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="text-heading">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
        <Section title="Additional Billing and Discounts" icon={CurrencyDollar}>
          {t.additionalBilling.length === 0 && t.discounts.length === 0 ? (
            <p className="text-sm text-muted">No additional billing or discounts.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm text-text">
              {t.additionalBilling.map((a) => (
                <li key={`b-${a.service}`}>
                  {a.service} ·{' '}
                  {a.billing === 'SEPARATE'
                    ? 'billed separately'
                    : a.billing === 'INCLUDED'
                      ? 'included'
                      : 'waived'}
                  {a.feeCents ? ` · ${money(a.feeCents)}` : ''}
                </li>
              ))}
              {t.discounts.map((d) => (
                <li key={`d-${d.label}`}>
                  {d.label} · {d.kind === 'PERCENT' ? `${d.value}%` : money(d.value)} off
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <PaymentSchedule clientId={clientId} limit={20} />
    </div>
  );
}

/** Engagement Documents: the agreement, the signed copy and the e-signature request. */
function DocumentsTab({
  t,
  act,
  engagementId,
  manager,
}: {
  t: BookkeepingTerms;
  act: Act;
  engagementId: string | undefined;
  manager: boolean;
}) {
  const d = t.documents;
  return (
    <Section title="Engagement Documents" icon={FileText} testId="terms-documents">
      <dl className="grid grid-cols-[11rem_minmax(0,1fr)] gap-y-1.5 text-sm">
        <dt className="text-muted">Agreement</dt>
        <dd className="text-heading">{d.agreement?.name ?? 'Not attached'}</dd>
        <dt className="text-muted">Signed agreement</dt>
        <dd className="text-heading">{d.signedAgreement?.name ?? 'Not uploaded'}</dd>
        <dt className="text-muted">E-signature request</dt>
        <dd className="text-heading">
          {d.esignRequest
            ? `${d.esignRequest.title} (${d.esignRequest.status.toLowerCase()})`
            : 'None'}
        </dd>
        <dt className="text-muted">Signed</dt>
        <dd className="text-heading">{d.signedAt ? dateTimeText(d.signedAt) : 'Not yet'}</dd>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <DownloadAgreement t={t} />
        {manager && d.signedAgreement && !d.signedAt ? (
          <button
            type="button"
            className={outlined}
            onClick={() =>
              void act(
                () => api.bookkeepingTerms.setAgreement(t.id, { signed: true }),
                'Marked as signed.',
              )
            }
          >
            <SealCheck aria-hidden weight="fill" className="size-4" /> Mark Signed
          </button>
        ) : null}
      </div>
      {!engagementId ? null : (
        <p className="mt-3 text-xs text-muted">
          Agreement files are kept with the client&apos;s documents; a signed version is never
          replaced: changes go into a new version.
        </p>
      )}
    </Section>
  );
}

/** Renewal & Notices: the term, renewal and notice period; notices and termination are recorded. */
function RenewalTab({ t, act, manager }: { t: BookkeepingTerms; act: Act; manager: boolean }) {
  const [kind, setKind] = useState<BookkeepingTermsNoticeRequest['kind']>('PRICE_CHANGE_NOTICE');
  const [effective, setEffective] = useState('');
  const [reason, setReason] = useState('');
  const [fee, setFee] = useState('');
  const [ending, setEnding] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const active = t.status === 'ACTIVE';
  return (
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2" data-testid="terms-renewal">
      <Section title="Term and Renewal" icon={ClockCounterClockwise}>
        <dl className="grid grid-cols-[10rem_minmax(0,1fr)] gap-y-1.5 text-sm">
          <dt className="text-muted">Start</dt>
          <dd className="text-heading">{dayText(t.startDate)}</dd>
          <dt className="text-muted">Agreement end</dt>
          <dd className="text-heading">{t.endDate ? dayText(t.endDate) : 'Open-ended'}</dd>
          <dt className="text-muted">Renewal</dt>
          <dd className="text-heading">{RENEWAL[t.renewalType]}</dd>
          <dt className="text-muted">Next renewal</dt>
          <dd className="text-heading">{t.renewalDate ? dayText(t.renewalDate) : 'Not set'}</dd>
          <dt className="text-muted">Notice period</dt>
          <dd className="text-heading">
            {t.noticeDays === null ? 'Not set' : `${t.noticeDays} days`}
          </dd>
        </dl>
      </Section>
      <Section title="Record a Notice" icon={PaperPlaneTilt}>
        {!active ? (
          <p className="text-sm text-muted">Notices are recorded on terms in force.</p>
        ) : !manager ? (
          <p className="text-sm text-muted">An Owner or Admin records notices.</p>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                () =>
                  api.bookkeepingTerms.recordNotice(t.id, {
                    kind,
                    ...(effective ? { effectiveDate: effective } : {}),
                    ...(reason.trim() ? { reason: reason.trim() } : {}),
                    ...(kind === 'PRICE_CHANGE_NOTICE' && fee
                      ? { newMonthlyFeeCents: cents(fee) }
                      : {}),
                  }),
                'Notice recorded.',
              ).then((ok) => {
                if (ok) {
                  setReason('');
                  setFee('');
                }
              });
            }}
          >
            <Select
              label="Notice"
              value={kind}
              onChange={(e) => setKind(e.target.value as BookkeepingTermsNoticeRequest['kind'])}
              options={[
                { value: 'PRICE_CHANGE_NOTICE', label: 'Price change notice' },
                { value: 'TERMINATION_NOTICE', label: 'Termination notice' },
                { value: 'RENEWED', label: 'Renewed' },
                { value: 'NOTE', label: 'Note' },
              ]}
            />
            <Input
              label="Effective date"
              type="date"
              value={effective}
              onChange={(e) => setEffective(e.target.value)}
            />
            {kind === 'PRICE_CHANGE_NOTICE' ? (
              <Input
                label="New monthly fee ($)"
                type="number"
                min={0}
                step="0.01"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
              />
            ) : null}
            <Textarea
              label="Reason or note"
              rows={2}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-xs text-muted">
              A notice is recorded in History; the terms change only through a new version.
            </p>
            <Button type="submit">Record Notice</Button>
          </form>
        )}
      </Section>
      {active && manager ? (
        <Section title="Terminate" icon={Prohibit}>
          {!ending ? (
            <button type="button" className={outlined} onClick={() => setEnding(true)}>
              Terminate These Terms
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <Input
                label="Effective date"
                type="date"
                value={effective}
                onChange={(e) => setEffective(e.target.value)}
              />
              <Textarea
                label="Reason"
                rows={2}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Checkbox
                label="I confirm these terms end on this date."
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
              />
              <Button
                disabled={!confirm || !effective || !reason.trim()}
                onClick={() =>
                  void act(
                    () =>
                      api.bookkeepingTerms.terminate(t.id, {
                        reason: reason.trim(),
                        effectiveDate: effective,
                      }),
                    'The terms were terminated.',
                  )
                }
              >
                Terminate
              </Button>
            </div>
          )}
        </Section>
      ) : null}
    </div>
  );
}

/** History: every version and every event, newest first. */
function HistoryTab({
  clientId,
  versions,
}: {
  clientId: string;
  versions: {
    id: string;
    version: number;
    status: BookkeepingTerms['status'];
    packageName: string | null;
    monthlyFeeCents: number;
    effectiveFrom: string;
  }[];
}) {
  const history = useApiQuery([...KEY(clientId), 'history'], () =>
    api.bookkeepingTerms.history(clientId, { limit: 50 }),
  );
  return (
    <div
      className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
      data-testid="terms-history"
    >
      <Section title="Versions" icon={Stack}>
        <ul className="flex flex-col gap-2 text-sm">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-heading">Version {v.version}</span>
              <Badge tone={TERMS_STATUS[v.status].tone}>{TERMS_STATUS[v.status].label}</Badge>
              <span className="text-muted">
                {v.packageName ?? 'No package'} · {money(v.monthlyFeeCents)} · from{' '}
                {dayText(v.effectiveFrom)}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="History" icon={ClockCounterClockwise}>
        {history.isPending ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : history.isError ? (
          <p className="text-sm text-muted">The history could not be loaded.</p>
        ) : history.data.items.length === 0 ? (
          <p className="text-sm text-muted">No history yet.</p>
        ) : (
          <ol className="flex flex-col">
            {history.data.items.map((e) => (
              <li key={e.id} className="border-t border-divider py-2 text-sm first:border-t-0">
                <p className="text-heading">{eventText(e)}</p>
                <p className="text-xs text-muted">
                  {e.actorName ? `${e.actorName} · ` : ''}
                  {dateTimeText(e.at)}
                  {e.reason ? ` · ${e.reason}` : ''}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
