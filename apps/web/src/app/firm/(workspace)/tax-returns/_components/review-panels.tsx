'use client';

import type {
  TaxApproval,
  TaxAuthorization,
  TaxCheckResult,
  TaxFilingAttempt,
  TaxReturnDetail,
  TaxReturnFiling,
} from '@firmivra/types';
import { Badge, Button, Input, Select, Textarea } from '@firmivra/ui';
import {
  CheckCircle,
  Info,
  PaperPlaneTilt,
  Plus,
  Warning,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { Dialog, useAct, useMembers, type Notice } from './return-actions';
import {
  BLOCKER_LABEL,
  TR_KEY,
  card,
  dateTimeText,
  dayText,
  money,
  quiet,
  today,
} from './tr-shared';

/** A panel of Frame 2's tabs and Frame 3: a white card with its title row. */
export function Panel({
  title,
  icon: Glyph,
  action,
  children,
  testId,
  id,
}: {
  title: string;
  icon?: typeof CheckCircle;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`${card} flex min-w-0 flex-col gap-3 p-4`}
      aria-label={title}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-heading">
          {Glyph ? <Glyph aria-hidden weight="fill" className="size-6 text-action" /> : null}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export const smallButton =
  'inline-flex min-h-9 items-center gap-1.5 rounded-control border border-action bg-surface px-3 text-sm font-medium text-action hover:bg-accent-soft disabled:border-divider disabled:text-muted';
export const textButton = 'text-sm font-medium text-link hover:underline disabled:text-muted';
const jurisdiction = (j: string | null) => (!j || j === 'US' ? 'Federal' : j);

/** Loads one part of the return (each refreshes with the module's key). */
export function usePart<T>(returnId: string, part: string, fn: () => Promise<T>) {
  return useApiQuery([...TR_KEY, part, returnId], fn);
}

// ---------- Validation ----------

const CHECK: Record<
  TaxCheckResult,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }
> = {
  VALID: { label: 'Valid', tone: 'success' },
  WARNING: { label: 'Warning', tone: 'warning' },
  ERROR: { label: 'Error', tone: 'danger' },
  INFO: { label: 'Info', tone: 'info' },
  OPEN: { label: 'Open', tone: 'neutral' },
  DONE: { label: 'Done', tone: 'success' },
};

/**
 * Return Validation: the reviewer's validation checks (critical errors block Ready to File,
 * warnings need acknowledging), and Run Final Validation, which records who checked and when.
 * Firmivra records the review; it does not run IRS schema validation.
 */
export function ValidationPanel({
  detail,
  onNotice,
  compact,
}: {
  detail: TaxReturnDetail;
  onNotice: Notice;
  compact?: boolean;
}) {
  const act = useAct(onNotice);
  const q = usePart(detail.id, 'checklist', () => api.taxReturnWorkspace.checklist(detail.id));
  const items = (q.data ?? []).filter((c) => c.section === 'VALIDATION');
  const [adding, setAdding] = useState(false);
  const count = (r: TaxCheckResult) => items.filter((c) => c.result === r).length;
  const errors = count('ERROR');
  const shown = compact ? items.slice(0, 5) : items;
  return (
    <Panel
      title="Return Validation"
      icon={CheckCircle}
      testId="validation"
      action={
        <button
          type="button"
          className={smallButton}
          disabled={!items.length || errors > 0}
          onClick={() =>
            void act(
              () => api.taxReturnWorkspace.finalValidation(detail.id),
              'Final validation recorded.',
            )
          }
        >
          Run Final Validation
        </button>
      }
    >
      {q.isError ? (
        <p role="alert" className={quiet}>
          Validation is not available right now.
        </p>
      ) : (
        <>
          <div className="flex items-start gap-3">
            {errors ? (
              <XCircle aria-hidden weight="fill" className="size-8 shrink-0 text-danger" />
            ) : (
              <CheckCircle aria-hidden weight="fill" className="size-8 shrink-0 text-success" />
            )}
            <div>
              <p className={`font-semibold ${errors ? 'text-danger' : 'text-success'}`}>
                {!items.length
                  ? 'No validation checks yet'
                  : errors
                    ? `${errors} critical ${errors === 1 ? 'error' : 'errors'} found`
                    : 'No critical errors found'}
              </p>
              <p className="text-sm text-muted">
                {detail.finalValidatedAt
                  ? `Final validation by ${detail.finalValidatedBy?.name ?? 'a member'}, ${dateTimeText(detail.finalValidatedAt)}.`
                  : 'Final validation has not been run.'}
              </p>
            </div>
          </div>
          <ul className="grid grid-cols-3 gap-2" aria-label="Validation counts">
            {(
              [
                ['ERROR', 'Errors', 'bg-danger-soft text-danger', XCircle],
                ['WARNING', 'Warnings', 'bg-warning-soft text-warning', Warning],
                ['INFO', 'Informational', 'bg-info-soft text-info', Info],
              ] as const
            ).map(([r, label, tone, Glyph]) => (
              <li key={r} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${tone}`}>
                <Glyph aria-hidden weight="fill" className="size-6" />
                <span className="flex flex-col leading-tight">
                  <span className="text-lg font-bold">{count(r)}</span>
                  <span className="text-sm">{label}</span>
                </span>
              </li>
            ))}
          </ul>
          {shown.length ? (
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Validation items</caption>
              <thead className="bg-table-head">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Item
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} className="border-b border-divider">
                    <td className="px-2 py-1.5">
                      {c.label}
                      {c.note ? <span className="block text-xs text-muted">{c.note}</span> : null}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={CHECK[c.result].tone}
                          icon={c.result === 'VALID' ? CheckCircle : WarningCircle}
                        >
                          {CHECK[c.result].label}
                        </Badge>
                        {c.result === 'WARNING' ? (
                          c.acknowledgedAt ? (
                            <span className="text-xs text-muted">Acknowledged</span>
                          ) : (
                            <button
                              type="button"
                              className={textButton}
                              onClick={() =>
                                void act(
                                  () =>
                                    api.taxReturnWorkspace.updateChecklistItem(detail.id, c.id, {
                                      acknowledge: true,
                                    }),
                                  'Warning acknowledged.',
                                )
                              }
                            >
                              Acknowledge
                            </button>
                          )
                        ) : null}
                        {!compact ? (
                          <select
                            aria-label={`Result for ${c.label}`}
                            className="rounded border border-divider bg-surface px-1 text-xs"
                            value={c.result}
                            onChange={(e) =>
                              void act(
                                () =>
                                  api.taxReturnWorkspace.updateChecklistItem(detail.id, c.id, {
                                    result: e.target.value as TaxCheckResult,
                                  }),
                                'Validation item updated.',
                              )
                            }
                          >
                            {(['VALID', 'INFO', 'WARNING', 'ERROR'] as const).map((r) => (
                              <option key={r} value={r}>
                                {CHECK[r].label}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className={quiet}>Add the checks the reviewer runs on this return.</p>
          )}
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" className={textButton} onClick={() => setAdding(true)}>
              + Add Validation Item
            </button>
            {compact && items.length > shown.length ? (
              <Link href={`/tax-returns/${detail.id}?tab=review`} className={textButton}>
                View All Validation Details →
              </Link>
            ) : null}
          </div>
        </>
      )}
      {adding ? (
        <AddCheckDialog
          returnId={detail.id}
          section="VALIDATION"
          onClose={() => setAdding(false)}
          onNotice={onNotice}
        />
      ) : null}
    </Panel>
  );
}

/** Adds a checklist line: a preparation or review step, or a validation check with its result. */
export function AddCheckDialog({
  returnId,
  section,
  onClose,
  onNotice,
}: {
  returnId: string;
  section: 'PREPARATION' | 'REVIEW' | 'VALIDATION';
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const [label, setLabel] = useState('');
  const [result, setResult] = useState<TaxCheckResult>('VALID');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const done = await act(
      () =>
        api.taxReturnWorkspace.addChecklistItem(returnId, {
          section,
          label: label.trim(),
          ...(section === 'VALIDATION' ? { result } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      'Item added.',
    );
    setBusy(false);
    if (done) onClose();
  };
  return (
    <Dialog
      title={section === 'VALIDATION' ? 'Add Validation Item' : 'Add Checklist Item'}
      confirm="Add"
      busy={busy}
      disabled={!label.trim()}
      onConfirm={() => void save()}
      onClose={onClose}
      testId="add-check-dialog"
    >
      <Input
        label="Item"
        value={label}
        maxLength={200}
        onChange={(e) => setLabel(e.target.value)}
      />
      {section === 'VALIDATION' ? (
        <Select
          label="Result"
          value={result}
          onChange={(e) => setResult(e.target.value as TaxCheckResult)}
          options={(['VALID', 'INFO', 'WARNING', 'ERROR'] as const).map((r) => ({
            value: r,
            label: CHECK[r].label,
          }))}
        />
      ) : null}
      <Textarea
        label="Note (optional)"
        value={note}
        maxLength={1000}
        onChange={(e) => setNote(e.target.value)}
      />
    </Dialog>
  );
}

// ---------- Approvals ----------

const APPROVAL: Record<
  TaxApproval['status'],
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  PENDING: { label: 'Pending', tone: 'warning' },
  APPROVED: { label: 'Completed', tone: 'success' },
  RETURNED: { label: 'Returned to preparer', tone: 'danger' },
  INVALIDATED: { label: 'Reopened', tone: 'neutral' },
};

/** Required Approvals: each step, who approves it, and approve or return to the preparer. */
export function ApprovalsPanel({
  detail,
  onNotice,
}: {
  detail: TaxReturnDetail;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const members = useMembers();
  const q = usePart(detail.id, 'approvals', () => api.taxReturnWorkspace.approvals(detail.id));
  const [adding, setAdding] = useState(false);
  const [returning, setReturning] = useState<TaxApproval>();
  const [step, setStep] = useState('');
  const [assignee, setAssignee] = useState('');
  const [note, setNote] = useState('');
  return (
    <Panel
      title="Required Approvals"
      icon={CheckCircle}
      testId="approvals"
      action={
        <button type="button" className={textButton} onClick={() => setAdding(true)}>
          + Add Step
        </button>
      }
    >
      {q.isError ? (
        <p role="alert" className={quiet}>
          Approvals are not available right now.
        </p>
      ) : !q.data?.length ? (
        <p className={quiet}>{q.isPending ? 'Loading…' : 'No approval steps yet.'}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-divider rounded-lg border border-divider text-sm">
          {q.data.map((a) => (
            <li
              key={a.id}
              className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-2 sm:grid-cols-[1fr_8rem_12rem]"
            >
              <span className="font-medium text-heading">{a.step}</span>
              <span className="hidden text-text sm:block">
                {a.assignedTo?.name ?? 'Anyone with approval'}
              </span>
              <span className="flex flex-col items-start gap-1">
                <Badge tone={APPROVAL[a.status].tone}>{APPROVAL[a.status].label}</Badge>
                {a.decidedAt ? (
                  <span className="text-xs text-muted">{dateTimeText(a.decidedAt)}</span>
                ) : null}
                {a.status === 'PENDING' ? (
                  <span className="flex flex-wrap gap-x-3">
                    <button
                      type="button"
                      className={textButton}
                      onClick={() =>
                        void act(
                          () => api.taxReturnWorkspace.approve(detail.id, a.id),
                          `${a.step} approved.`,
                        )
                      }
                    >
                      Approve
                    </button>
                    <button type="button" className={textButton} onClick={() => setReturning(a)}>
                      Return to Preparer
                    </button>
                  </span>
                ) : null}
                {a.note ? <span className="text-xs text-text">“{a.note}”</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <Dialog
          title="Add Approval Step"
          confirm="Add Step"
          disabled={!step.trim()}
          onConfirm={() =>
            void act(
              () =>
                api.taxReturnWorkspace.addApproval(detail.id, {
                  step: step.trim(),
                  assignedUserId: assignee || null,
                }),
              'Approval step added.',
            ).then((r) => {
              if (r) {
                setAdding(false);
                setStep('');
              }
            })
          }
          onClose={() => setAdding(false)}
          testId="add-approval-dialog"
        >
          <Input
            label="Step"
            placeholder="Final Review / Approval"
            value={step}
            maxLength={100}
            onChange={(e) => setStep(e.target.value)}
          />
          <Select
            label="Approver"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            options={[{ value: '', label: 'Anyone with approval' }, ...members]}
          />
        </Dialog>
      ) : null}
      {returning ? (
        <Dialog
          title="Return to Preparer"
          subtitle={returning.step}
          confirm="Return to Preparer"
          disabled={!note.trim()}
          onConfirm={() =>
            void act(
              () =>
                api.taxReturnWorkspace.returnToPreparer(detail.id, returning.id, {
                  note: note.trim(),
                }),
              'Returned to the preparer.',
            ).then((r) => {
              if (r) {
                setReturning(undefined);
                setNote('');
              }
            })
          }
          onClose={() => setReturning(undefined)}
          testId="return-dialog"
        >
          <Textarea
            label="Review note for the preparer"
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
          />
        </Dialog>
      ) : null}
    </Panel>
  );
}

// ---------- Client signatures (authorizations) ----------

const AUTH_STATUS: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }
> = {
  NOT_SENT: { label: 'Not Sent', tone: 'neutral' },
  SIGNED: { label: 'Completed', tone: 'success' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  DRAFT: { label: 'Draft', tone: 'neutral' },
  NEEDS_APPROVAL: { label: 'Needs Approval', tone: 'warning' },
  SENT: { label: 'Pending', tone: 'warning' },
  DELIVERED: { label: 'Pending', tone: 'warning' },
  VIEWED: { label: 'Viewed', tone: 'info' },
  PARTIALLY_SIGNED: { label: 'Partially Signed', tone: 'info' },
  DECLINED: { label: 'Declined', tone: 'danger' },
  EXPIRED: { label: 'Expired', tone: 'danger' },
  VOIDED: { label: 'Voided', tone: 'neutral' },
};
export const authLabel = (a: Pick<TaxAuthorization, 'kind' | 'jurisdiction'>) =>
  a.kind === 'FEDERAL_EFILE'
    ? 'Form 8879 – Federal e-file authorization'
    : a.kind === 'STATE_EFILE'
      ? `${a.jurisdiction} e-file authorization`
      : 'Client consent / engagement';

/**
 * Client Signatures: the authorizations the return needs (Form 8879, a state's, the consent),
 * sent through Firm Sign or signed on paper. An unsigned required one blocks Ready to File.
 */
export function SignaturesPanel({
  detail,
  onNotice,
}: {
  detail: TaxReturnDetail;
  onNotice: Notice;
}) {
  const q = usePart(detail.id, 'authorizations', () =>
    api.taxReturnWorkspace.authorizations(detail.id),
  );
  const [manage, setManage] = useState(false);
  const [link, setLink] = useState<TaxAuthorization>();
  const [wet, setWet] = useState<TaxAuthorization>();
  return (
    <Panel
      id="signatures"
      title="Client Signatures"
      icon={CheckCircle}
      testId="signatures"
      action={
        <span className="flex gap-2">
          <Link href={`/firm-sign/new?clientId=${detail.client.id}`} className={smallButton}>
            View / Send
          </Link>
          <button type="button" className={smallButton} onClick={() => setManage(true)}>
            Manage
          </button>
        </span>
      }
    >
      {q.isError ? (
        <p role="alert" className={quiet}>
          Signatures are not available right now.
        </p>
      ) : !q.data?.length ? (
        <p className={quiet}>
          {q.isPending
            ? 'Loading…'
            : 'No authorizations are required yet. Use Manage to add Form 8879.'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-divider rounded-lg border border-divider text-sm">
          {q.data.map((a) => {
            const s = AUTH_STATUS[a.status] ?? AUTH_STATUS['NOT_SENT']!;
            return (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <span className="flex flex-col">
                  <span className="text-heading">
                    {authLabel(a)}
                    {a.required ? '' : ' (if required)'}
                  </span>
                  {a.status !== 'SIGNED' && a.status !== 'COMPLETED' ? (
                    <span className="flex flex-wrap gap-x-3">
                      <button type="button" className={textButton} onClick={() => setLink(a)}>
                        Link Firm Sign request
                      </button>
                      <button type="button" className={textButton} onClick={() => setWet(a)}>
                        Signed on paper
                      </button>
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-col items-end">
                  <Badge tone={s.tone} icon={s.tone === 'success' ? CheckCircle : WarningCircle}>
                    {s.label}
                  </Badge>
                  {a.signedOn ? (
                    <span className="text-xs text-muted">{dayText(a.signedOn)}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {manage ? (
        <ManageAuthorizations
          detail={detail}
          current={q.data ?? []}
          onClose={() => setManage(false)}
          onNotice={onNotice}
        />
      ) : null}
      {link ? (
        <LinkRequestDialog
          detail={detail}
          auth={link}
          onClose={() => setLink(undefined)}
          onNotice={onNotice}
        />
      ) : null}
      {wet ? (
        <WetSignatureDialog
          detail={detail}
          auth={wet}
          onClose={() => setWet(undefined)}
          onNotice={onNotice}
        />
      ) : null}
    </Panel>
  );
}

function ManageAuthorizations({
  detail,
  current,
  onClose,
  onNotice,
}: {
  detail: TaxReturnDetail;
  current: TaxAuthorization[];
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const has = (kind: TaxAuthorization['kind']) => current.some((a) => a.kind === kind);
  const [federal, setFederal] = useState(() => (current.length ? has('FEDERAL_EFILE') : true));
  const [consent, setConsent] = useState(() => has('CLIENT_CONSENT'));
  const [states, setStates] = useState(
    current
      .filter((a) => a.kind === 'STATE_EFILE')
      .map((a) => a.jurisdiction)
      .join(', '),
  );
  const list = states
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const bad = list.some((s) => !/^[A-Z]{2}$/.test(s));
  const save = () =>
    void act(
      () =>
        api.taxReturnWorkspace.setAuthorizations(detail.id, {
          items: [
            ...(federal ? [{ kind: 'FEDERAL_EFILE' as const }] : []),
            ...list.map((j) => ({ kind: 'STATE_EFILE' as const, jurisdiction: j })),
            ...(consent ? [{ kind: 'CLIENT_CONSENT' as const }] : []),
          ],
        }),
      'Authorizations saved.',
    ).then((r) => r && onClose());
  return (
    <Dialog
      title="Required Authorizations"
      confirm="Save"
      disabled={bad}
      onConfirm={save}
      onClose={onClose}
      testId="manage-auth-dialog"
    >
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={federal}
          onChange={(e) => setFederal(e.target.checked)}
        />
        Form 8879 – Federal e-file authorization
      </label>
      <Input
        label="State authorizations (two-letter codes)"
        value={states}
        onChange={(e) => setStates(e.target.value)}
        {...(bad ? { error: 'Use two-letter state codes, separated by commas' } : {})}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        Client consent / engagement
      </label>
    </Dialog>
  );
}

function LinkRequestDialog({
  detail,
  auth,
  onClose,
  onNotice,
}: {
  detail: TaxReturnDetail;
  auth: TaxAuthorization;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const requests = useApiQuery([...TR_KEY, 'esign', detail.client.id], () =>
    api.esign.list({ clientId: detail.client.id, limit: 50 }),
  );
  const [id, setId] = useState('');
  return (
    <Dialog
      title="Link Firm Sign Request"
      subtitle={authLabel(auth)}
      confirm="Link"
      disabled={!id}
      onConfirm={() =>
        void act(
          () =>
            api.taxReturnWorkspace.linkAuthorization(detail.id, auth.id, { esignRequestId: id }),
          'Signature request linked.',
        ).then((r) => r && onClose())
      }
      onClose={onClose}
      testId="link-auth-dialog"
    >
      <Select
        label="Signature request"
        value={id}
        onChange={(e) => setId(e.target.value)}
        options={[
          {
            value: '',
            label: requests.isPending
              ? 'Loading…'
              : requests.data?.items.length
                ? 'Choose a request'
                : 'This client has no signature requests',
          },
          ...(requests.data?.items ?? []).map((r) => ({
            value: r.id,
            label: `${r.title} (${r.status.toLowerCase().replace('_', ' ')})`,
          })),
        ]}
      />
      <Link href={`/firm-sign/new?clientId=${detail.client.id}`} className={textButton}>
        Send a new request with Firm Sign
      </Link>
    </Dialog>
  );
}

function WetSignatureDialog({
  detail,
  auth,
  onClose,
  onNotice,
}: {
  detail: TaxReturnDetail;
  auth: TaxAuthorization;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const docs = useApiQuery([...TR_KEY, 'client-docs', detail.client.id], () =>
    api.documents.list(detail.client.id, { limit: 100 }),
  );
  const [signedOn, setSignedOn] = useState(today);
  const [doc, setDoc] = useState('');
  return (
    <Dialog
      title="Signed on Paper"
      subtitle={authLabel(auth)}
      confirm="Record Signature"
      disabled={!doc || !signedOn}
      onConfirm={() =>
        void act(
          () =>
            api.taxReturnWorkspace.wetSignature(detail.id, auth.id, { signedOn, documentId: doc }),
          'Signature recorded.',
        ).then((r) => r && onClose())
      }
      onClose={onClose}
      testId="wet-dialog"
    >
      <Input
        label="Signed on"
        type="date"
        max={today()}
        value={signedOn}
        onChange={(e) => setSignedOn(e.target.value)}
      />
      <Select
        label="Signed form (the scan in the client's documents)"
        value={doc}
        onChange={(e) => setDoc(e.target.value)}
        options={[
          { value: '', label: docs.isPending ? 'Loading…' : 'Choose the document' },
          ...(docs.data?.items ?? []).map((d) => ({ value: d.id, label: d.fileName })),
        ]}
      />
    </Dialog>
  );
}

// ---------- E-file and filing status ----------

const FILING_STATUS: Record<
  TaxReturnFiling['status'],
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }
> = {
  NOT_FILED: { label: 'Not Transmitted', tone: 'neutral' },
  TRANSMITTED: { label: 'Transmitted', tone: 'info' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  PAPER_FILED: { label: 'Paper Filed', tone: 'success' },
};

/**
 * E-File & Filing Status: each jurisdiction's filing and its transmissions. Firmivra records
 * what the tax software or the agency confirmed; it never transmits. A rejected transmission
 * stays in the history when the return is sent again.
 */
export function EfilePanel({ detail, onNotice }: { detail: TaxReturnDetail; onNotice: Notice }) {
  const q = usePart(detail.id, 'filings', () => api.taxReturnWorkspace.filings(detail.id));
  const [record, setRecord] = useState<TaxReturnFiling>();
  const [answer, setAnswer] = useState<{ filing: TaxReturnFiling; attempt: TaxFilingAttempt }>();
  const [paper, setPaper] = useState<TaxReturnFiling>();
  const [manage, setManage] = useState(false);
  const filings = (q.data ?? []).filter((f) => f.required || f.attempts.length);
  const ready =
    detail.workflowStatus === 'READY_TO_FILE' ||
    detail.workflowStatus === 'REJECTED' ||
    detail.workflowStatus === 'TRANSMITTED';
  const sent = filings.some((f) => f.status !== 'NOT_FILED');
  const rejected = filings.filter((f) => f.status === 'REJECTED');
  const banner = rejected.length
    ? {
        tone: 'bg-danger-soft text-danger',
        title: 'Rejected',
        text: 'Correct the return and record the new transmission. The rejected attempt stays in the history.',
      }
    : !sent
      ? {
          tone: 'bg-danger-soft text-danger',
          title: 'Not yet transmitted',
          text: ready
            ? 'Ready to file: record the transmission from your tax software.'
            : 'Complete review and obtain client signatures before e-filing.',
        }
      : filings.every((f) => f.status === 'ACCEPTED' || f.status === 'PAPER_FILED')
        ? {
            tone: 'bg-success-soft text-success',
            title: 'Accepted',
            text: 'Every required filing is accepted or paper filed.',
          }
        : {
            tone: 'bg-info-soft text-info',
            title: 'Waiting for acknowledgment',
            text: 'Record the agency’s answer when the tax software shows it.',
          };
  return (
    <Panel
      id="efile"
      title="E-File & Filing Status"
      icon={PaperPlaneTilt}
      testId="efile"
      action={
        <span className="flex gap-2">
          <button type="button" className={smallButton} onClick={() => setManage(true)}>
            Jurisdictions
          </button>
          <Button
            disabled={
              !ready ||
              !filings.some(
                (f) =>
                  f.filingMethod === 'EFILE' &&
                  f.status !== 'ACCEPTED' &&
                  f.status !== 'TRANSMITTED',
              )
            }
            onClick={() =>
              setRecord(
                filings.find(
                  (f) =>
                    f.filingMethod === 'EFILE' &&
                    (f.status === 'NOT_FILED' || f.status === 'REJECTED'),
                ),
              )
            }
          >
            <PaperPlaneTilt aria-hidden weight="fill" className="size-4" /> Record Transmission
          </Button>
        </span>
      }
    >
      <div className={`flex items-start gap-3 rounded-lg px-3 py-2 ${banner.tone}`} role="status">
        <WarningCircle aria-hidden weight="fill" className="size-7 shrink-0" />
        <span>
          <span className="block font-semibold">{banner.title}</span>
          <span className="text-sm text-text">{banner.text}</span>
        </span>
      </div>
      {q.isError ? (
        <p role="alert" className={quiet}>
          Filings are not available right now.
        </p>
      ) : !filings.length ? (
        <p className={quiet}>
          {q.isPending ? 'Loading…' : 'No jurisdictions yet. Add the federal and state filings.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filings.map((f) => {
            const last = f.attempts[0];
            const s = FILING_STATUS[f.status];
            return (
              <li
                key={f.id}
                className="rounded-lg border border-divider p-3 text-sm"
                data-testid={`filing-${f.jurisdiction}`}
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <p>
                    <span className="block font-semibold text-heading">
                      {jurisdiction(f.jurisdiction)} Status
                      {f.filingMethod === 'PAPER' ? ' (paper)' : ''}
                    </span>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </p>
                  <p>
                    <span className="block font-semibold text-heading">Date Transmitted</span>
                    {last
                      ? dateTimeText(last.transmittedAt)
                      : f.paperFiledOn
                        ? dayText(f.paperFiledOn)
                        : '—'}
                  </p>
                  <p>
                    <span className="block font-semibold text-heading">Submission ID</span>
                    {last?.submissionId ?? '—'}
                  </p>
                  <p>
                    <span className="block font-semibold text-heading">Acknowledgment</span>
                    {last
                      ? last.ackStatus === 'PENDING'
                        ? 'Pending'
                        : `${last.ackStatus === 'ACCEPTED' ? 'Accepted' : 'Rejected'}${last.acknowledgedAt ? `, ${dateTimeText(last.acknowledgedAt)}` : ''}`
                      : '—'}
                  </p>
                </div>
                {last?.ackStatus === 'REJECTED' ? (
                  <p className="mt-2 rounded bg-danger-soft px-2 py-1 text-danger">
                    {last.rejectCode ? `${last.rejectCode}: ` : ''}
                    {last.rejectDescription ?? 'No description recorded.'}
                    {last.correctiveAction ? (
                      <span className="block text-text">Action: {last.correctiveAction}</span>
                    ) : null}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-3">
                  {f.filingMethod === 'EFILE' && last?.ackStatus === 'PENDING' ? (
                    <button
                      type="button"
                      className={textButton}
                      onClick={() => setAnswer({ filing: f, attempt: last })}
                    >
                      Record Acknowledgment
                    </button>
                  ) : null}
                  {f.filingMethod === 'EFILE' &&
                  ready &&
                  (!last || last.ackStatus === 'REJECTED') ? (
                    <button type="button" className={textButton} onClick={() => setRecord(f)}>
                      {last ? 'Record Retransmission' : 'Record Transmission'}
                    </button>
                  ) : null}
                  {f.filingMethod === 'PAPER' && !f.paperFiledOn ? (
                    <button type="button" className={textButton} onClick={() => setPaper(f)}>
                      Record Paper Filing
                    </button>
                  ) : null}
                </div>
                {f.attempts.length > 1 ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-muted">
                      Earlier attempts ({f.attempts.length - 1})
                    </summary>
                    <ul className="mt-1 flex flex-col gap-1">
                      {f.attempts.slice(1).map((a) => (
                        <li key={a.id} className="text-muted">
                          {a.submissionId} · {dateTimeText(a.transmittedAt)} ·{' '}
                          {a.ackStatus.toLowerCase()}
                          {a.rejectCode ? ` (${a.rejectCode})` : ''}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2 text-sm text-text">
        <Info aria-hidden weight="fill" className="size-5 shrink-0 text-info" />
        Firmivra records transmissions and acknowledgments from your tax software; it does not
        transmit returns itself. E-file is available after the required signatures and Ready to
        File.
      </p>
      {record ? (
        <AttemptDialog
          detail={detail}
          filing={record}
          onClose={() => setRecord(undefined)}
          onNotice={onNotice}
        />
      ) : null}
      {answer ? (
        <AckDialog
          detail={detail}
          attempt={answer.attempt}
          filing={answer.filing}
          onClose={() => setAnswer(undefined)}
          onNotice={onNotice}
        />
      ) : null}
      {paper ? (
        <PaperDialog
          detail={detail}
          filing={paper}
          onClose={() => setPaper(undefined)}
          onNotice={onNotice}
        />
      ) : null}
      {manage ? (
        <JurisdictionsDialog
          detail={detail}
          current={q.data ?? []}
          onClose={() => setManage(false)}
          onNotice={onNotice}
        />
      ) : null}
    </Panel>
  );
}

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const toIso = (local: string) => new Date(local).toISOString();

function AttemptDialog({
  detail,
  filing,
  onClose,
  onNotice,
}: {
  detail: TaxReturnDetail;
  filing: TaxReturnFiling;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const [submissionId, setSubmissionId] = useState('');
  const [at, setAt] = useState(nowLocal);
  const [future, setFuture] = useState(false);
  return (
    <Dialog
      title={filing.attempts.length ? 'Record Retransmission' : 'Record Transmission'}
      subtitle={`${jurisdiction(filing.jurisdiction)} return, as your tax software transmitted it`}
      confirm="Record"
      disabled={!submissionId.trim() || !at || future}
      onConfirm={() =>
        void act(
          () =>
            api.taxReturnWorkspace.recordAttempt(detail.id, filing.id, {
              submissionId: submissionId.trim(),
              transmittedAt: toIso(at),
            }),
          'Transmission recorded.',
        ).then((r) => r && onClose())
      }
      onClose={onClose}
      testId="attempt-dialog"
    >
      <Input
        label="Submission ID"
        value={submissionId}
        maxLength={50}
        onChange={(e) => setSubmissionId(e.target.value)}
      />
      <Input
        label="Transmitted at"
        type="datetime-local"
        value={at}
        onChange={(e) => {
          setAt(e.target.value);
          setFuture(new Date(e.target.value).getTime() > Date.now() + 60_000);
        }}
        {...(future ? { error: 'Not in the future' } : {})}
      />
    </Dialog>
  );
}

function AckDialog({
  detail,
  filing,
  attempt,
  onClose,
  onNotice,
}: {
  detail: TaxReturnDetail;
  filing: TaxReturnFiling;
  attempt: TaxFilingAttempt;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const [result, setResult] = useState<'ACCEPTED' | 'REJECTED'>('ACCEPTED');
  const [at, setAt] = useState(nowLocal);
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [action, setAction] = useState('');
  return (
    <Dialog
      title="Record Acknowledgment"
      subtitle={`${jurisdiction(filing.jurisdiction)} · ${attempt.submissionId}`}
      confirm="Record"
      disabled={!at}
      onConfirm={() =>
        void act(
          () =>
            api.taxReturnWorkspace.updateAttempt(
              detail.id,
              attempt.id,
              result === 'ACCEPTED'
                ? { ackStatus: 'ACCEPTED', acknowledgedAt: toIso(at) }
                : {
                    ackStatus: 'REJECTED',
                    acknowledgedAt: toIso(at),
                    ...(code.trim() ? { rejectCode: code.trim() } : {}),
                    ...(description.trim() ? { rejectDescription: description.trim() } : {}),
                    ...(action.trim() ? { correctiveAction: action.trim() } : {}),
                  },
            ),
          'Acknowledgment recorded.',
        ).then((r) => r && onClose())
      }
      onClose={onClose}
      testId="ack-dialog"
    >
      <Select
        label="Answer"
        value={result}
        onChange={(e) => setResult(e.target.value as 'ACCEPTED' | 'REJECTED')}
        options={[
          { value: 'ACCEPTED', label: 'Accepted' },
          { value: 'REJECTED', label: 'Rejected' },
        ]}
      />
      <Input
        label="Acknowledged at"
        type="datetime-local"
        value={at}
        onChange={(e) => setAt(e.target.value)}
      />
      {result === 'REJECTED' ? (
        <>
          <Input
            label="Reject code"
            value={code}
            maxLength={50}
            onChange={(e) => setCode(e.target.value)}
          />
          <Textarea
            label="Description"
            value={description}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Textarea
            label="Corrective action"
            value={action}
            maxLength={2000}
            onChange={(e) => setAction(e.target.value)}
          />
        </>
      ) : null}
    </Dialog>
  );
}

function PaperDialog({
  detail,
  filing,
  onClose,
  onNotice,
}: {
  detail: TaxReturnDetail;
  filing: TaxReturnFiling;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const [on, setOn] = useState(today);
  return (
    <Dialog
      title="Record Paper Filing"
      subtitle={`${jurisdiction(filing.jurisdiction)} return (never shown as e-filed)`}
      confirm="Record"
      disabled={!on}
      onConfirm={() =>
        void act(
          () => api.taxReturnWorkspace.paperFiled(detail.id, filing.id, { paperFiledOn: on }),
          'Paper filing recorded.',
        ).then((r) => r && onClose())
      }
      onClose={onClose}
      testId="paper-dialog"
    >
      <Input
        label="Mailed on"
        type="date"
        max={today()}
        value={on}
        onChange={(e) => setOn(e.target.value)}
      />
    </Dialog>
  );
}

function JurisdictionsDialog({
  detail,
  current,
  onClose,
  onNotice,
}: {
  detail: TaxReturnDetail;
  current: TaxReturnFiling[];
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const [rows, setRows] = useState(
    current.length
      ? current.map((f) => ({
          jurisdiction: f.jurisdiction,
          filingMethod: f.filingMethod,
          required: f.required,
          locked: f.attempts.length > 0,
        }))
      : [{ jurisdiction: 'US', filingMethod: 'EFILE' as const, required: true, locked: false }],
  );
  const [state, setState] = useState('');
  const set = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Dialog
      title="Filing Jurisdictions"
      subtitle="Each jurisdiction is tracked on its own"
      confirm="Save"
      disabled={!rows.length}
      onConfirm={() =>
        void act(
          () =>
            api.taxReturnWorkspace.setFilings(detail.id, {
              filings: rows.map(({ jurisdiction: j, filingMethod, required }) => ({
                jurisdiction: j,
                filingMethod,
                required,
              })),
            }),
          'Jurisdictions saved.',
        ).then((r) => r && onClose())
      }
      onClose={onClose}
      testId="jurisdictions-dialog"
    >
      <ul className="flex flex-col gap-2 text-sm">
        {rows.map((r, i) => (
          <li key={r.jurisdiction} className="flex flex-wrap items-center gap-3">
            <span className="w-16 font-medium">{jurisdiction(r.jurisdiction)}</span>
            <select
              aria-label={`${jurisdiction(r.jurisdiction)} filing method`}
              disabled={r.locked}
              className="rounded border border-divider bg-surface px-2 py-1"
              value={r.filingMethod}
              onChange={(e) => set(i, { filingMethod: e.target.value as 'EFILE' | 'PAPER' })}
            >
              <option value="EFILE">E-file</option>
              <option value="PAPER">Paper</option>
            </select>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                className="size-4"
                checked={r.required}
                onChange={(e) => set(i, { required: e.target.checked })}
              />
              Required
            </label>
            {!r.locked ? (
              <button
                type="button"
                className={textButton}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex items-end gap-2">
        <div className="w-32">
          <Input
            label="Add a state"
            maxLength={2}
            value={state}
            onChange={(e) => setState(e.target.value.toUpperCase())}
          />
        </div>
        <button
          type="button"
          className={smallButton}
          disabled={!/^[A-Z]{2}$/.test(state) || rows.some((r) => r.jurisdiction === state)}
          onClick={() => {
            setRows([
              ...rows,
              { jurisdiction: state, filingMethod: 'EFILE', required: true, locked: false },
            ]);
            setState('');
          }}
        >
          <Plus aria-hidden weight="bold" className="size-4" /> Add
        </button>
      </div>
    </Dialog>
  );
}

// ---------- Federal & state summary ----------

/** Federal & State Summary: the refund or amount due per jurisdiction, estimated until final. */
export function SummaryPanel({ detail, onNotice }: { detail: TaxReturnDetail; onNotice: Notice }) {
  const q = usePart(detail.id, 'filings', () => api.taxReturnWorkspace.filings(detail.id));
  const [edit, setEdit] = useState<TaxReturnFiling>();
  const filings = (q.data ?? []).filter((f) => f.required || f.attempts.length);
  return (
    <Panel title="Federal & State Summary" testId="summary">
      {q.isError ? (
        <p role="alert" className={quiet}>
          The summary is not available right now.
        </p>
      ) : !filings.length ? (
        <p className={quiet}>{q.isPending ? 'Loading…' : 'No jurisdictions yet.'}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Refund or amount due by jurisdiction</caption>
          <thead className="bg-table-head">
            <tr>
              {['Type', 'Amount', 'Status'].map((h) => (
                <th key={h} scope="col" className="px-2 py-1.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filings.map((f) => {
              const due = (f.amountDueCents ?? 0) > 0;
              return (
                <tr key={f.id} className="border-b border-divider">
                  <th scope="row" className="px-2 py-1.5 font-normal">
                    <button
                      type="button"
                      className="text-left hover:text-link hover:underline"
                      onClick={() => setEdit(f)}
                    >
                      {jurisdiction(f.jurisdiction)} {due ? 'Amount Due' : 'Refund'}
                    </button>
                  </th>
                  <td className="px-2 py-1.5 font-bold text-heading">
                    {money(due ? f.amountDueCents : f.refundCents)}
                  </td>
                  <td className="px-2 py-1.5">
                    {f.amountStatus ? (
                      <Badge
                        tone={f.amountStatus === 'FINAL' ? 'success' : 'info'}
                        icon={CheckCircle}
                      >
                        {f.amountStatus === 'FINAL' ? 'Final' : 'Estimated'}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted">
        Refund amounts are estimates and not guaranteed. Amounts update after e-file acceptance.
      </p>
      {edit ? (
        <AmountDialog
          detail={detail}
          filing={edit}
          onClose={() => setEdit(undefined)}
          onNotice={onNotice}
        />
      ) : null}
    </Panel>
  );
}

function AmountDialog({
  detail,
  filing,
  onClose,
  onNotice,
}: {
  detail: TaxReturnDetail;
  filing: TaxReturnFiling;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const [kind, setKind] = useState((filing.amountDueCents ?? 0) > 0 ? 'due' : 'refund');
  const start = (filing.amountDueCents ?? 0) > 0 ? filing.amountDueCents : filing.refundCents;
  const [amount, setAmount] = useState(start === null ? '' : String(start / 100));
  const [status, setStatus] = useState(filing.amountStatus ?? 'ESTIMATED');
  const cents = amount.trim() === '' ? null : Math.round(Number(amount) * 100);
  const bad = cents !== null && (!Number.isFinite(cents) || cents < 0);
  return (
    <Dialog
      title={`${jurisdiction(filing.jurisdiction)} Refund or Amount Due`}
      confirm="Save"
      disabled={bad}
      onConfirm={() =>
        void act(
          () =>
            api.taxReturnWorkspace.updateFiling(detail.id, filing.id, {
              refundCents: kind === 'refund' ? cents : null,
              amountDueCents: kind === 'due' ? cents : null,
              amountStatus: cents === null ? null : status,
            }),
          'Amount saved.',
        ).then((r) => r && onClose())
      }
      onClose={onClose}
      testId="amount-dialog"
    >
      <Select
        label="Type"
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        options={[
          { value: 'refund', label: 'Refund' },
          { value: 'due', label: 'Amount due' },
        ]}
      />
      <Input
        label="Amount ($)"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        {...(bad ? { error: 'Enter an amount of zero or more' } : {})}
      />
      <Select
        label="Status"
        value={status}
        onChange={(e) => setStatus(e.target.value as 'ESTIMATED' | 'FINAL')}
        options={[
          { value: 'ESTIMATED', label: 'Estimated' },
          { value: 'FINAL', label: 'Final' },
        ]}
      />
    </Dialog>
  );
}

// ---------- Next steps ----------

/** Next Steps: what still stands between the return and its next stage, from the API's blockers. */
export function NextSteps({ detail }: { detail: TaxReturnDetail }) {
  // A step is done only when there is something there that is done: no authorization or
  // approval set up yet is not "signed" or "approved".
  const auths = usePart(detail.id, 'authorizations', () =>
    api.taxReturnWorkspace.authorizations(detail.id),
  );
  const approvals = usePart(detail.id, 'approvals', () =>
    api.taxReturnWorkspace.approvals(detail.id),
  );
  const steps: { label: string; done: boolean }[] = [
    {
      label: 'Obtain client signatures (Form 8879)',
      done:
        (auths.data ?? []).some((a) => a.required) &&
        !detail.blockers.includes('AUTHORIZATION_UNSIGNED'),
    },
    {
      label: 'Complete final validation',
      done:
        !!detail.finalValidatedAt &&
        !detail.blockers.some(
          (b) => b.startsWith('VALIDATION') || b === 'WARNINGS_NOT_ACKNOWLEDGED',
        ),
    },
    {
      label: 'Complete the required approvals',
      done:
        (approvals.data ?? []).length > 0 &&
        !detail.blockers.includes('APPROVAL_PENDING') &&
        !detail.blockers.includes('APPROVAL_RETURNED'),
    },
    {
      label: 'Mark as Ready to File',
      done: ['READY_TO_FILE', 'TRANSMITTED', 'ACCEPTED', 'REJECTED', 'CLOSED'].includes(
        detail.workflowStatus,
      ),
    },
    {
      label: 'Transmit to the IRS and state',
      done: ['TRANSMITTED', 'ACCEPTED', 'CLOSED'].includes(detail.workflowStatus),
    },
    {
      label: 'Monitor acknowledgments',
      done: ['ACCEPTED', 'CLOSED'].includes(detail.workflowStatus),
    },
  ];
  const extra = detail.blockers.filter(
    (b) =>
      b === 'ORIGINAL_NOT_FILED' || b === 'NO_FILING_TRANSMITTED' || b === 'FILINGS_NOT_ACCEPTED',
  );
  return (
    <Panel title="Next Steps" testId="next-steps">
      <ul className="flex flex-col gap-1.5 text-sm">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <input
              type="checkbox"
              readOnly
              checked={s.done}
              aria-label={s.label}
              className="size-4"
            />
            <span className={s.done ? 'text-muted line-through' : 'text-text'}>{s.label}</span>
          </li>
        ))}
        {extra.map((b) => (
          <li key={b} className="flex items-center gap-2 text-danger">
            <WarningCircle aria-hidden weight="fill" className="size-4" />
            {BLOCKER_LABEL[b]}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
