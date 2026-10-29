'use client';

import {
  CUSTOM_TERM_LIMITS,
  offeredPaymentTerms,
  PAYMENT_TERM_DAYS,
  type PaymentPreferences,
  PaymentTerm,
  paymentTermLabel,
  UpdatePaymentPreferencesRequest,
} from '@firmivra/types';
import { Button, Card, Modal, Toggle } from '@firmivra/ui';
import { X } from '@phosphor-icons/react';
import { type ReactNode, useId, useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';

// Settings > Payments' billing sections (Octavia's Invoices & Payments review of Oct 27, IP-F13):
// Invoice Defaults, Reminders & Automations and Taxes & Fees, on the firm's canonical settings.
// Every option is off until the firm turns it on; one Save Changes for the three sections.

const KEY = ['payment-preferences'];
const field = 'min-h-10 rounded-control border border-control-border bg-surface px-3 text-sm';

type Sections = Omit<PaymentPreferences, 'updatedAt'>;

function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-heading">
        {label}
      </label>
      {children(id)}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-divider pt-3">
      <div>
        <p className="text-sm font-medium text-heading">{label}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <span className="flex items-center gap-2 text-sm text-text">
        <Toggle label={label} checked={checked} onChange={onChange} />
        {checked ? 'On' : 'Off'}
      </span>
    </div>
  );
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <Labelled label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`${field} w-28`}
        />
      )}
    </Labelled>
  );
}

/**
 * The firm's own payment terms beside the four standard ones (#1220's `custom_term_days`): each a
 * number of days, offered on Create Invoice and as the default. Saved with Save Changes.
 */
function CustomTerms({
  days,
  onChange,
}: {
  days: readonly number[];
  onChange: (days: number[]) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const n = Number(draft);
  const standard = Object.values(PAYMENT_TERM_DAYS);
  const full = days.length >= CUSTOM_TERM_LIMITS.maxTerms;
  const problem = !draft
    ? null
    : !Number.isInteger(n) || n < CUSTOM_TERM_LIMITS.minDays || n > CUSTOM_TERM_LIMITS.maxDays
      ? 'Use a whole number of days, 1 to 365.'
      : standard.includes(n)
        ? `Net ${n} is already a standard term.`
        : days.includes(n)
          ? `Net ${n} is in your list already.`
          : null;
  const add = () => {
    if (!draft || problem || full) return;
    onChange([...days, n].sort((a, b) => a - b));
    setDraft('');
  };
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-2">
      <h3 id={`${id}-title`} className="text-sm font-medium text-heading">
        Your payment terms
      </h3>
      <p className="text-xs text-muted">
        Offered beside Due on Receipt, Net 7, Net 14 and Net 30. Up to 12, each 1 to 365 days.
      </p>
      {days.length === 0 ? (
        <p className="text-sm text-muted">No terms of your own yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {days.map((d) => (
            <li
              key={d}
              className="flex items-center gap-1 rounded-pill bg-info-soft py-1 pr-1 pl-3 text-sm text-heading"
            >
              {paymentTermLabel(`net_${d}`)}
              <button
                type="button"
                aria-label={`Remove Net ${d}`}
                onClick={() => onChange(days.filter((x) => x !== d))}
                className="flex size-6 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-danger"
              >
                <X aria-hidden weight="bold" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Labelled label="Days">
          {(fieldId) => (
            <input
              id={fieldId}
              type="number"
              min={CUSTOM_TERM_LIMITS.minDays}
              max={CUSTOM_TERM_LIMITS.maxDays}
              step={1}
              value={draft}
              disabled={full}
              aria-invalid={problem !== null}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
              className={`${field} w-28`}
            />
          )}
        </Labelled>
        <Button
          type="button"
          variant="secondary"
          disabled={!draft || problem !== null || full}
          onClick={add}
        >
          Add Terms
        </Button>
      </div>
      {problem ? (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      ) : full ? (
        <p className="text-xs text-muted">Your list is full: remove one to add another.</p>
      ) : null}
    </section>
  );
}

/** The three sections and their one Save Changes, Cancel and Reset to Default. */
export function BillingPreferences() {
  const prefs = useApiQuery(KEY, () => api.paymentPreferences.get());
  // Kept here: a save remounts the form on the saved values, and the message must outlive it.
  const [done, setDone] = useState<string | null>(null);
  return (
    <PageState query={prefs}>
      {(saved) => (
        <PreferencesForm
          key={saved.updatedAt ?? 'defaults'}
          saved={saved}
          done={done}
          setDone={setDone}
        />
      )}
    </PageState>
  );
}

function PreferencesForm({
  saved,
  done,
  setDone,
}: {
  saved: PaymentPreferences;
  done: string | null;
  setDone: (message: string | null) => void;
}) {
  const { updatedAt, ...start } = saved;
  const [form, setForm] = useState<Sections>(start);
  const [confirmReset, setConfirmReset] = useState(false);
  const save = useApiMutation(
    (body: Sections) => api.paymentPreferences.update({ ...body, updatedAt }),
    {
      invalidate: KEY,
    },
  );
  const reset = useApiMutation(() => api.paymentPreferences.reset({ updatedAt }), {
    invalidate: KEY,
  });
  const dirty = JSON.stringify(form) !== JSON.stringify(start);
  const check = UpdatePaymentPreferencesRequest.safeParse({ ...form, updatedAt });
  const problem = check.success
    ? null
    : (check.error.issues[0]?.message ?? 'Check the highlighted values.');
  const set = <K extends keyof Sections>(key: K, patch: Partial<Sections[K]>) => {
    setDone(null);
    setForm({ ...form, [key]: { ...form[key], ...patch } });
  };
  const d = form.invoiceDefaults;
  const r = form.reminders;
  const f = form.taxesAndFees;
  const error = save.error ?? reset.error;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3" aria-labelledby="invoice-defaults-title">
          <h2 id="invoice-defaults-title" className="text-xl font-bold text-heading">
            Invoice Defaults
          </h2>
          <p className="text-sm text-text">What every new invoice starts with.</p>
          <Labelled
            label="Invoice number prefix"
            hint={`Next numbers look like ${d.invoicePrefix || ''}001248.`}
          >
            {(id) => (
              <input
                id={id}
                value={d.invoicePrefix}
                maxLength={10}
                onChange={(e) => set('invoiceDefaults', { invoicePrefix: e.target.value })}
                className={`${field} w-40`}
              />
            )}
          </Labelled>
          <Labelled label="Default payment terms">
            {(id) => (
              <select
                id={id}
                value={d.defaultTerms}
                onChange={(e) =>
                  set('invoiceDefaults', { defaultTerms: PaymentTerm.parse(e.target.value) })
                }
                className={`${field} w-48`}
              >
                {offeredPaymentTerms(d.customTermDays).map((t) => (
                  <option key={t} value={t}>
                    {paymentTermLabel(t)}
                  </option>
                ))}
              </select>
            )}
          </Labelled>
          <CustomTerms
            days={d.customTermDays}
            onChange={(customTermDays) => set('invoiceDefaults', { customTermDays })}
          />
          <Labelled label="Default memo" hint="Printed on new invoices; up to 500 characters.">
            {(id) => (
              <textarea
                id={id}
                rows={3}
                maxLength={500}
                value={d.defaultMemo ?? ''}
                onChange={(e) => set('invoiceDefaults', { defaultMemo: e.target.value || null })}
                className="rounded-control border border-control-border bg-surface px-3 py-2 text-sm"
              />
            )}
          </Labelled>
          <Templates />
        </Card>

        <Card className="flex flex-col gap-3" aria-labelledby="reminders-title">
          <h2 id="reminders-title" className="text-xl font-bold text-heading">
            Reminders & Automations
          </h2>
          <p className="text-sm text-text">Nothing goes out by itself until you turn it on.</p>
          <Switch
            label="Payment reminders"
            hint="Email the client before an invoice is due."
            checked={r.sendReminders}
            onChange={(on) => set('reminders', { sendReminders: on })}
          />
          {r.sendReminders ? (
            <NumberField
              label="Days before the due date"
              value={r.reminderDaysBefore}
              min={0}
              max={60}
              onChange={(n) => set('reminders', { reminderDaysBefore: n })}
            />
          ) : null}
          <Switch
            label="Overdue notices"
            hint="Email the client when an invoice becomes overdue."
            checked={r.notifyOverdue}
            onChange={(on) => set('reminders', { notifyOverdue: on })}
          />
          {r.notifyOverdue ? (
            <NumberField
              label="Repeat every (days, 0 for once)"
              value={r.overdueReminderDays}
              min={0}
              max={90}
              onChange={(n) => set('reminders', { overdueReminderDays: n })}
            />
          ) : null}
          <Switch
            label="Automatic receipts"
            hint="Send a receipt after each successful payment, once."
            checked={r.autoReceipts}
            onChange={(on) => set('reminders', { autoReceipts: on })}
          />
          <Switch
            label="Auto-apply payments"
            hint="A payment that names no invoice pays the client's oldest open invoice."
            checked={r.autoApplyPayments}
            onChange={(on) => set('reminders', { autoApplyPayments: on })}
          />
          <div className="flex flex-wrap gap-4 border-t border-divider pt-3">
            <NumberField
              label="AutoPay retries"
              hint="Where the provider supports them; 0 for none."
              value={r.retryAttempts}
              min={0}
              max={10}
              onChange={(n) => set('reminders', { retryAttempts: n })}
            />
            <NumberField
              label="Days between retries"
              value={r.retryIntervalDays}
              min={1}
              max={14}
              onChange={(n) => set('reminders', { retryIntervalDays: n })}
            />
          </div>
        </Card>
      </div>

      <Card className="flex flex-col gap-3" aria-labelledby="taxes-fees-title">
        <h2 id="taxes-fees-title" className="text-xl font-bold text-heading">
          Taxes & Fees
        </h2>
        <p className="text-sm text-text">Configured here only: invoices never use a fixed rate.</p>
        <TaxRates />
        <Switch
          label="Late fee"
          hint="Added to an overdue balance."
          checked={f.lateFeeEnabled}
          onChange={(on) =>
            set('taxesAndFees', {
              lateFeeEnabled: on,
              lateFeeType: on ? (f.lateFeeType ?? 'PERCENT') : f.lateFeeType,
            })
          }
        />
        {f.lateFeeEnabled ? (
          <div className="flex flex-wrap items-end gap-4">
            <Labelled label="Late fee type">
              {(id) => (
                <select
                  id={id}
                  value={f.lateFeeType ?? 'PERCENT'}
                  onChange={(e) =>
                    set('taxesAndFees', { lateFeeType: e.target.value as 'PERCENT' | 'FIXED' })
                  }
                  className={`${field} w-40`}
                >
                  <option value="PERCENT">Percentage</option>
                  <option value="FIXED">Fixed amount</option>
                </select>
              )}
            </Labelled>
            {f.lateFeeType === 'FIXED' ? (
              <Labelled label="Amount ($)">
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={f.lateFeeCents === null ? '' : f.lateFeeCents / 100}
                    onChange={(e) =>
                      set('taxesAndFees', {
                        lateFeeCents: e.target.value
                          ? Math.round(Number(e.target.value) * 100)
                          : null,
                      })
                    }
                    className={`${field} w-32`}
                  />
                )}
              </Labelled>
            ) : (
              <Labelled label="Percent of the balance">
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    min={0.01}
                    max={100}
                    step={0.01}
                    value={f.lateFeePercent ?? ''}
                    onChange={(e) =>
                      set('taxesAndFees', {
                        lateFeePercent: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    className={`${field} w-32`}
                  />
                )}
              </Labelled>
            )}
          </div>
        ) : null}
        <Switch
          label="Tipping"
          hint="Lets an invoice offer the client a tip."
          checked={f.tippingEnabled}
          onChange={(on) => set('taxesAndFees', { tippingEnabled: on })}
        />
        <Switch
          label="Payment before the due date"
          hint="Lets an invoice ask for payment before it is due."
          checked={f.requirePaymentBeforeDue}
          onChange={(on) => set('taxesAndFees', { requirePaymentBeforeDue: on })}
        />
      </Card>

      <Card className="flex flex-col gap-3" aria-labelledby="deposit-accounts-title">
        <h2 id="deposit-accounts-title" className="text-xl font-bold text-heading">
          Deposit Accounts
        </h2>
        <p className="text-sm text-text">
          Where your firm deposits payments it records. Record Payment offers them as Deposit To.
        </p>
        <DepositAccounts />
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!dirty || problem !== null || save.isPending}
          onClick={() => save.mutate(form, { onSuccess: () => setDone('Changes saved.') })}
        >
          {save.isPending ? 'Saving…' : 'Save Changes'}
        </Button>
        <Button variant="secondary" disabled={!dirty} onClick={() => setForm(start)}>
          Cancel
        </Button>
        <Button variant="ghost" onClick={() => setConfirmReset(true)}>
          Reset to Default
        </Button>
        {dirty && problem ? (
          <p role="alert" className="text-sm text-danger">
            {problem}
          </p>
        ) : null}
        {done ? (
          <p role="status" className="text-sm text-success">
            {done}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(error)} Your changes are kept.
          </p>
        ) : null}
      </div>
      <Modal
        open={confirmReset}
        title="Reset billing settings to default?"
        onClose={() => setConfirmReset(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>
              Keep my settings
            </Button>
            <Button
              onClick={() =>
                reset.mutate(undefined, {
                  onSuccess: () => {
                    setConfirmReset(false);
                    setDone('Settings reset to default.');
                  },
                })
              }
            >
              Reset
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          Invoice Defaults, Reminders & Automations and the late fee, tipping and early payment
          options go back to their defaults, with every option off. Your tax rates and templates
          stay.
        </p>
      </Modal>
    </div>
  );
}

/** The firm's taxes (Taxes & Fees): add, make default, archive. */
function TaxRates() {
  const list = useApiQuery(['invoice-tax-rates'], () => api.paymentPreferences.taxRates());
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const add = useApiMutation(
    () =>
      api.paymentPreferences.createTaxRate({
        name,
        rateBps: Math.round(Number(rate) * 100),
        isDefault: false,
      }),
    { invalidate: ['invoice-tax-rates'] },
  );
  const archive = useApiMutation((id: string) => api.paymentPreferences.archiveTaxRate(id), {
    invalidate: ['invoice-tax-rates'],
  });
  const makeDefault = useApiMutation(
    (t: { id: string; name: string; rateBps: number }) =>
      api.paymentPreferences.updateTaxRate(t.id, {
        name: t.name,
        rateBps: t.rateBps,
        isDefault: true,
      }),
    { invalidate: ['invoice-tax-rates'] },
  );
  return (
    <section aria-label="Taxes" className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-heading">Taxes</h3>
      <PageState
        query={list}
        isEmpty={(d) => d.items.length === 0}
        empty="No taxes yet. Add the rates your firm charges."
      >
        {(d) => (
          <ul className="divide-y divide-divider rounded-control border border-border">
            {d.items.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1 font-medium text-heading">{t.name}</span>
                <span className="text-text">{(t.rateBps / 100).toFixed(2)}%</span>
                {t.isDefault ? (
                  <span className="rounded-pill bg-info-soft px-2 py-0.5 text-xs font-medium text-info">
                    Default
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-link underline"
                    onClick={() => makeDefault.mutate(t)}
                  >
                    Make default
                  </button>
                )}
                <button
                  type="button"
                  className="text-link underline"
                  onClick={() => archive.mutate(t.id)}
                >
                  Archive<span className="sr-only"> {t.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PageState>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(undefined, { onSuccess: () => (setName(''), setRate('')) });
        }}
      >
        <Labelled label="Tax name">
          {(id) => (
            <input
              id={id}
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              className={`${field} w-44`}
            />
          )}
        </Labelled>
        <Labelled label="Rate (%)">
          {(id) => (
            <input
              id={id}
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className={`${field} w-28`}
            />
          )}
        </Labelled>
        <Button
          type="submit"
          variant="secondary"
          disabled={!name.trim() || rate === '' || add.isPending}
        >
          Add Tax
        </Button>
      </form>
      {(add.error ?? archive.error ?? makeDefault.error) ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(add.error ?? archive.error ?? makeDefault.error)}
        </p>
      ) : null}
    </section>
  );
}

/** IP-F12: deposit accounts (Record Payment's Deposit To): add, make default, archive. */
function DepositAccounts() {
  const list = useApiQuery(['deposit-accounts'], () => api.paymentPreferences.depositAccounts());
  const [name, setName] = useState('');
  const add = useApiMutation(
    () => api.paymentPreferences.createDepositAccount({ name, isDefault: false }),
    { invalidate: ['deposit-accounts'] },
  );
  const archive = useApiMutation((id: string) => api.paymentPreferences.archiveDepositAccount(id), {
    invalidate: ['deposit-accounts'],
  });
  const makeDefault = useApiMutation(
    (a: { id: string; name: string }) =>
      api.paymentPreferences.updateDepositAccount(a.id, { name: a.name, isDefault: true }),
    { invalidate: ['deposit-accounts'] },
  );
  return (
    <section aria-label="Deposit accounts" className="flex flex-col gap-2">
      <PageState
        query={list}
        isEmpty={(d) => d.items.length === 0}
        empty="No deposit accounts yet. Add the accounts your firm deposits into."
      >
        {(d) => (
          <ul className="divide-y divide-divider rounded-control border border-border">
            {d.items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1 font-medium text-heading">{a.name}</span>
                {a.isDefault ? (
                  <span className="rounded-pill bg-info-soft px-2 py-0.5 text-xs font-medium text-info">
                    Default
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-link underline"
                    onClick={() => makeDefault.mutate(a)}
                  >
                    Make default<span className="sr-only"> {a.name}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="text-link underline"
                  onClick={() => archive.mutate(a.id)}
                >
                  Archive<span className="sr-only"> {a.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PageState>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(undefined, { onSuccess: () => setName('') });
        }}
      >
        <Labelled label="Account name">
          {(id) => (
            <input
              id={id}
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              className={`${field} w-64`}
            />
          )}
        </Labelled>
        <Button type="submit" variant="secondary" disabled={!name.trim() || add.isPending}>
          Add Account
        </Button>
      </form>
      {(add.error ?? archive.error ?? makeDefault.error) ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(add.error ?? archive.error ?? makeDefault.error)}
        </p>
      ) : null}
    </section>
  );
}

/** Invoice templates (Invoice Defaults' branding and template): add, make default, archive. */
function Templates() {
  const list = useApiQuery(['invoice-templates'], () => api.paymentPreferences.templates());
  const [name, setName] = useState('');
  const [showLogo, setShowLogo] = useState(true);
  const add = useApiMutation(() => api.paymentPreferences.createTemplate({ name, showLogo }), {
    invalidate: ['invoice-templates'],
  });
  const archive = useApiMutation((id: string) => api.paymentPreferences.archiveTemplate(id), {
    invalidate: ['invoice-templates'],
  });
  const makeDefault = useApiMutation(
    (t: {
      id: string;
      name: string;
      description: string | null;
      memo: string | null;
      footer: string | null;
      showLogo: boolean;
    }) => api.paymentPreferences.updateTemplate(t.id, { ...t, isDefault: true }),
    { invalidate: ['invoice-templates'] },
  );
  return (
    <section
      aria-label="Invoice templates"
      className="flex flex-col gap-2 border-t border-divider pt-3"
    >
      <h3 className="text-sm font-semibold text-heading">Templates</h3>
      <PageState
        query={list}
        isEmpty={(d) => d.items.length === 0}
        empty="No templates yet. New invoices use your firm's branding."
      >
        {(d) => (
          <ul className="divide-y divide-divider rounded-control border border-border">
            {d.items.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1 font-medium text-heading">{t.name}</span>
                <span className="text-xs text-muted">{t.showLogo ? 'With logo' : 'No logo'}</span>
                {t.isDefault ? (
                  <span className="rounded-pill bg-info-soft px-2 py-0.5 text-xs font-medium text-info">
                    Default
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-link underline"
                    onClick={() => makeDefault.mutate(t)}
                  >
                    Make default
                  </button>
                )}
                <button
                  type="button"
                  className="text-link underline"
                  onClick={() => archive.mutate(t.id)}
                >
                  Archive<span className="sr-only"> {t.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PageState>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(undefined, { onSuccess: () => setName('') });
        }}
      >
        <Labelled label="Template name">
          {(id) => (
            <input
              id={id}
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              className={`${field} w-44`}
            />
          )}
        </Labelled>
        <label className="flex min-h-10 items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={showLogo}
            onChange={(e) => setShowLogo(e.target.checked)}
          />
          Show logo
        </label>
        <Button type="submit" variant="secondary" disabled={!name.trim() || add.isPending}>
          Add Template
        </Button>
      </form>
      {(add.error ?? archive.error ?? makeDefault.error) ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(add.error ?? archive.error ?? makeDefault.error)}
        </p>
      ) : null}
    </section>
  );
}
