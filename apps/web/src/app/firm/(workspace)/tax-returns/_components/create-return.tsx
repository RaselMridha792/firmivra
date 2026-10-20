'use client';

import { ApiRequestError, type TaxReturnTab, type TaxpayerFilingStatus } from '@firmivra/types';
import { Input, Select, Textarea } from '@firmivra/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { Dialog, useMembers } from './return-actions';
import { FILING_STATUS_LABEL, FORM_TYPES, TR_ERRORS, TR_KEY, quiet } from './tr-shared';

const TAX_TYPES: { value: Exclude<TaxReturnTab, 'all'>; label: string }[] = [
  { value: 'personal', label: 'Personal Tax' },
  { value: 'business', label: 'Business Tax' },
  { value: 'quarterly', label: 'Quarterly Taxes' },
  { value: 'amended', label: 'Amended Return' },
  { value: 'prior_year', label: 'Prior Year Return' },
];
const STATE = /^[A-Z]{2}$/;

/**
 * Create New Return (developer guide, section 5): pick the client, the tax type and the details;
 * the return starts In Preparation and its workspace opens. The same client, year, form and quarter
 * again asks before it creates a duplicate.
 */
export function CreateReturnDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const clients = useApiQuery([...TR_KEY, 'clients'], () => api.clients.list({ limit: 100 }));
  const members = useMembers();
  const [clientId, setClientId] = useState('');
  const [taxType, setTaxType] = useState<(typeof TAX_TYPES)[number]['value']>('personal');
  const [year, setYear] = useState(() => String(new Date().getFullYear() - 1));
  const [formType, setFormType] = useState('');
  const [quarter, setQuarter] = useState('1');
  const [filingStatus, setFilingStatus] = useState('');
  const [states, setStates] = useState('');
  const [preparer, setPreparer] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [original, setOriginal] = useState('');
  const [reason, setReason] = useState('');
  const [duplicate, setDuplicate] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const client = clients.data?.items.find((c) => c.id === clientId);
  const filingType =
    taxType === 'business' || (taxType !== 'personal' && client?.accountType === 'BUSINESS')
      ? 'BUSINESS'
      : 'INDIVIDUAL';
  const amended = taxType === 'amended';
  const quarterly = taxType === 'quarterly';
  // The client's filed returns, for the amendment's original.
  const filed = useApiQuery([...TR_KEY, 'filed', clientId], () =>
    clientId && amended ? api.taxReturns.listForClient(clientId) : Promise.resolve([]),
  );
  const originals = (filed.data ?? []).filter((r) => r.status !== 'IN_PROGRESS' && !r.quarter);
  const stateList = states
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const badStates = stateList.some((s) => !STATE.test(s));
  const badYear = !/^\d{4}$/.test(year);
  const forms = FORM_TYPES.filter((f) => f.filingType === filingType);
  const ready =
    !!clientId && !badYear && !badStates && (!amended || (!!original && !!reason.trim()));

  const create = async (allowDuplicate: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      const created = await api.taxReturnWorkspace.create({
        clientId,
        taxYear: Number(year),
        filingType,
        ...(quarterly ? { quarter: Number(quarter) } : {}),
        ...(formType
          ? { formType }
          : quarterly
            ? { formType: filingType === 'BUSINESS' ? '1120-W' : '1040-ES' }
            : {}),
        ...(filingType === 'INDIVIDUAL' && !quarterly && filingStatus
          ? { filingStatus: filingStatus as TaxpayerFilingStatus }
          : {}),
        ...(preparer ? { preparerUserId: preparer } : {}),
        ...(reviewer ? { reviewerUserId: reviewer } : {}),
        ...(dueOn ? { dueOn } : {}),
        ...(!quarterly && stateList.length ? { states: stateList } : {}),
        ...(amended ? { amendsReturnId: original, amendReason: reason.trim() } : {}),
        allowDuplicate,
      });
      router.push(`/tax-returns/${created.id}`);
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'DUPLICATE_RETURN' && !allowDuplicate) {
        setDuplicate(true);
      } else setError(errorMessage(e, TR_ERRORS));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Create New Return"
      subtitle="Start a tax record for a client. It begins In Preparation."
      confirm={duplicate ? 'Create Anyway' : 'Create Return'}
      busy={busy}
      disabled={!ready}
      onConfirm={() => void create(duplicate)}
      onClose={onClose}
      testId="create-dialog"
    >
      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {duplicate ? (
        <p role="alert" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-text">
          This client already has a {year} {formType || 'return'}
          {quarterly ? ` for Q${quarter}` : ''}. Create another one anyway?
        </p>
      ) : null}
      <div className="flex flex-col gap-1">
        <Select
          label="Client"
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setDuplicate(false);
          }}
          options={[
            {
              value: '',
              label: clients.isPending
                ? 'Loading clients…'
                : clients.isError
                  ? 'Clients could not be loaded'
                  : 'Choose a client',
            },
            ...(clients.data?.items ?? [])
              .filter((c) => !c.archivedAt)
              .map((c) => ({ value: c.id, label: c.displayName })),
          ]}
        />
        <Link href="/clients" className="text-sm text-link hover:underline">
          Client not listed? Add the client first
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Tax type"
          value={taxType}
          onChange={(e) => {
            setTaxType(e.target.value as typeof taxType);
            setFormType('');
            setDuplicate(false);
          }}
          options={TAX_TYPES}
        />
        <Input
          label="Tax year"
          inputMode="numeric"
          maxLength={4}
          value={year}
          onChange={(e) => {
            setYear(e.target.value);
            setDuplicate(false);
          }}
          {...(badYear ? { error: 'Enter a four-digit year' } : {})}
        />
      </div>
      {amended ? (
        <>
          <Select
            label="Original return"
            value={original}
            onChange={(e) => setOriginal(e.target.value)}
            options={[
              {
                value: '',
                label: !clientId
                  ? 'Choose the client first'
                  : originals.length
                    ? 'Choose the filed return'
                    : 'This client has no filed return',
              },
              ...originals.map((r) => ({
                value: r.id,
                label: `${r.taxYear} ${r.formType ?? 'return'}`,
              })),
            ]}
          />
          <Textarea
            label="Reason for the amendment"
            value={reason}
            maxLength={2000}
            onChange={(e) => setReason(e.target.value)}
          />
        </>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Return type"
          value={formType}
          onChange={(e) => {
            setFormType(e.target.value);
            setDuplicate(false);
          }}
          options={[
            { value: '', label: 'Choose a form' },
            ...forms.map((f) => ({ value: f.value, label: f.label })),
          ]}
        />
        {quarterly ? (
          <Select
            label="Quarter"
            value={quarter}
            onChange={(e) => {
              setQuarter(e.target.value);
              setDuplicate(false);
            }}
            options={[1, 2, 3, 4].map((q) => ({ value: String(q), label: `Q${q}` }))}
          />
        ) : filingType === 'INDIVIDUAL' ? (
          <Select
            label="Filing status"
            value={filingStatus}
            onChange={(e) => setFilingStatus(e.target.value)}
            options={[
              { value: '', label: 'Not set yet' },
              ...Object.entries(FILING_STATUS_LABEL).map(([value, l]) => ({ value, label: l })),
            ]}
          />
        ) : (
          <span />
        )}
      </div>
      {!quarterly ? (
        <Input
          label="State returns (two-letter codes, e.g. GA, NY)"
          value={states}
          onChange={(e) => setStates(e.target.value)}
          {...(badStates ? { error: 'Use two-letter state codes, separated by commas' } : {})}
        />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Preparer"
          value={preparer}
          onChange={(e) => setPreparer(e.target.value)}
          options={[{ value: '', label: 'Unassigned' }, ...members]}
        />
        <Select
          label="Reviewer"
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
          options={[{ value: '', label: 'Unassigned' }, ...members]}
        />
      </div>
      <Input
        label="Due date"
        type="date"
        value={dueOn}
        onChange={(e) => setDueOn(e.target.value)}
      />
    </Dialog>
  );
}

/**
 * Import Return and Bulk Upload Returns: a return comes in from a connected tax-software
 * integration. None is connected through Firmivra yet, so this says so instead of pretending.
 */
export function ImportDialog({ bulk, onClose }: { bulk?: boolean; onClose: () => void }) {
  const router = useRouter();
  return (
    <Dialog
      title={bulk ? 'Bulk Upload Returns' : 'Import Return'}
      subtitle="From an approved tax-software integration"
      confirm="Open Integrations"
      onConfirm={() => router.push('/integrations')}
      onClose={onClose}
      testId="import-dialog"
    >
      <p className="text-sm text-text">
        Returns are imported from a connected tax-software integration, matched to an existing
        client, and checked for duplicates before they are created. No tax-software integration is
        connected for your firm yet.
      </p>
      <p className={quiet}>
        Until then, use Create New Return and link the return&apos;s documents from the
        client&apos;s Documents.
      </p>
    </Dialog>
  );
}
