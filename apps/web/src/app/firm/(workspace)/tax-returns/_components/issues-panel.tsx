'use client';

import type {
  CreateTaxValidationIssueRequest,
  TaxIssueSeverity,
  TaxReturnDetail,
  TaxValidationIssue,
} from '@firmivra/types';
import { Badge, Radio, Select, Textarea } from '@firmivra/ui';
import { CheckCircle, WarningOctagon } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { Dialog, useAct, useMembers, type Notice } from './return-actions';
import { Panel, textButton, usePart } from './review-panels';
import { dateTimeText, quiet } from './tr-shared';

// Octavia's TX-F19 and F20: the reviewer's validation issues. An unresolved Error blocks Ready to
// File and filing; a Manual Warning needs review but does not block; Info does not block. A line
// marked Valid resolves nothing, and none of it is a provider's or the IRS's validation.

export const SEVERITY: Record<
  TaxIssueSeverity,
  { label: string; tone: 'danger' | 'warning' | 'info'; hint: string }
> = {
  ERROR: { label: 'Error', tone: 'danger', hint: 'Blocks Ready to File and filing until resolved' },
  MANUAL_WARNING: {
    label: 'Manual Warning',
    tone: 'warning',
    hint: 'Needs review; does not block filing',
  },
  INFO: { label: 'Info', tone: 'info', hint: 'For information; does not block filing' },
};

export interface IssueDraft {
  severity: TaxIssueSeverity;
  note: string;
  responsibleUserId: string;
  draftDocumentId: string;
  checklistItemId: string;
}

export const blankIssue = (responsibleUserId = ''): IssueDraft => ({
  severity: 'ERROR',
  note: '',
  responsibleUserId,
  draftDocumentId: '',
  checklistItemId: '',
});

export const issueBody = (d: IssueDraft): CreateTaxValidationIssueRequest => ({
  severity: d.severity,
  note: d.note.trim(),
  responsibleUserId: d.responsibleUserId || null,
  draftDocumentId: d.draftDocumentId || null,
  checklistItemId: d.checklistItemId || null,
});

/** The issue's fields: severity, the note, who resolves it, the version and the checklist line. */
export function IssueFields({
  returnId,
  value,
  onChange,
}: {
  returnId: string;
  value: IssueDraft;
  onChange: (next: IssueDraft) => void;
}) {
  const members = useMembers();
  const docs = usePart(returnId, 'documents', () => api.taxReturnWorkspace.documents(returnId));
  const lines = usePart(returnId, 'checklist', () => api.taxReturnWorkspace.checklist(returnId));
  const drafts = (docs.data ?? []).filter((d) => d.kind === 'DRAFT_RETURN');
  const set = (patch: Partial<IssueDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-3" data-testid="issue-fields">
      <div className="flex flex-col gap-1">
        <Select
          label="Severity"
          value={value.severity}
          onChange={(e) => set({ severity: e.target.value as TaxIssueSeverity })}
          options={(['ERROR', 'MANUAL_WARNING', 'INFO'] as const).map((s) => ({
            value: s,
            label: SEVERITY[s].label,
          }))}
        />
        <p className="text-xs text-muted">{SEVERITY[value.severity].hint}</p>
      </div>
      <Textarea
        label="Issue"
        value={value.note}
        maxLength={2000}
        onChange={(e) => set({ note: e.target.value })}
      />
      <Select
        label="Responsible person"
        value={value.responsibleUserId}
        onChange={(e) => set({ responsibleUserId: e.target.value })}
        options={[{ value: '', label: 'No one yet' }, ...members]}
      />
      <Select
        label="Version (draft return)"
        value={value.draftDocumentId}
        onChange={(e) => set({ draftDocumentId: e.target.value })}
        options={[
          { value: '', label: drafts.length ? 'Not tied to a version' : 'No draft return linked' },
          ...drafts.map((d) => ({ value: d.document.id, label: d.document.fileName })),
        ]}
      />
      <Select
        label="Checklist line"
        value={value.checklistItemId}
        onChange={(e) => set({ checklistItemId: e.target.value })}
        options={[
          { value: '', label: 'None' },
          ...(lines.data ?? []).map((l) => ({ value: l.id, label: l.label })),
        ]}
      />
    </div>
  );
}

/**
 * TX-F19, in Return to Preparer: raise an issue with the decision, or name the return's open
 * issues the preparer must fix. The parent sends `issueBody(draft)` and the ids chosen.
 */
export function ReturnIssueChoice({
  returnId,
  raise,
  onRaise,
  draft,
  onDraft,
  linked,
  onLinked,
}: {
  returnId: string;
  raise: boolean;
  onRaise: (on: boolean) => void;
  draft: IssueDraft;
  onDraft: (next: IssueDraft) => void;
  linked: string[];
  onLinked: (ids: string[]) => void;
}) {
  const q = usePart(returnId, 'issues', () => api.taxReturnWorkspace.issues(returnId));
  const open = (q.data ?? []).filter((i) => !i.resolvedAt);
  return (
    <>
      {open.length ? (
        <fieldset className="flex flex-col gap-1.5" data-testid="return-open-issues">
          <legend className="mb-1 text-sm font-medium text-heading">Open issues to fix</legend>
          {open.map((i) => (
            <label key={i.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={linked.includes(i.id)}
                onChange={(e) =>
                  onLinked(e.target.checked ? [...linked, i.id] : linked.filter((x) => x !== i.id))
                }
              />
              <span className="min-w-0 wrap-anywhere">
                <span className="font-medium">{SEVERITY[i.severity].label}:</span> {i.note}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <label className="flex items-center gap-2 text-sm font-medium text-heading">
        <input
          type="checkbox"
          className="size-4"
          checked={raise}
          onChange={(e) => onRaise(e.target.checked)}
        />
        Raise a validation issue
      </label>
      {raise ? <IssueFields returnId={returnId} value={draft} onChange={onDraft} /> : null}
    </>
  );
}

/**
 * Review 2 (TX-F21): the rule for resolving, shown where issues and validation lines change. The
 * API enforces it: who may, the reason (kept in the return's history), and the re-review.
 */
export function ResolveRule() {
  return (
    <div className="rounded-lg bg-canvas p-3 text-xs text-muted" data-testid="resolve-rule">
      <p className="font-semibold text-heading">How issues are resolved</p>
      <ul className="list-disc pl-4">
        <li>
          The return&apos;s preparer or reviewer resolves an issue or lowers a check; an Owner or
          Admin may too, recorded as an override.
        </li>
        <li>
          Resolving, marking a check Valid or changing its severity needs a reason, kept in the
          return&apos;s history.
        </li>
        <li>Valid means it was checked and needs no change (resolved without a fix).</li>
        <li>
          Resolving or lowering an Error after Ready for Review sends the return back to Ready for
          Review for the reviewer&apos;s approval.
        </li>
      </ul>
    </div>
  );
}

/** Past Ready for Review, where resolving or lowering an Error sends the return back. */
export const pastReview = (status: TaxReturnDetail['workflowStatus']) =>
  status === 'READY_FOR_SIGNATURE' || status === 'READY_TO_FILE';

/** Validation Issues: each issue, who resolves it, and Resolve or Reopen for those who may. */
export function IssuesPanel({ detail, onNotice }: { detail: TaxReturnDetail; onNotice: Notice }) {
  const act = useAct(onNotice);
  const members = useMembers();
  const q = usePart(detail.id, 'issues', () => api.taxReturnWorkspace.issues(detail.id));
  const [raising, setRaising] = useState(false);
  const [draft, setDraft] = useState<IssueDraft>(() => blankIssue(detail.preparer?.userId));
  const [handing, setHanding] = useState<TaxValidationIssue>();
  const [to, setTo] = useState('');
  // Review 2 (TX-F21): Resolve asks how (Fixed or Valid) and why.
  const [resolving, setResolving] = useState<TaxValidationIssue>();
  const [resolution, setResolution] = useState<'FIXED' | 'VALID'>('FIXED');
  const [reason, setReason] = useState('');
  const errors = (q.data ?? []).filter((i) => !i.resolvedAt && i.severity === 'ERROR').length;
  return (
    <Panel
      title="Validation Issues"
      icon={WarningOctagon}
      testId="validation-issues"
      action={
        <button
          type="button"
          className={textButton}
          onClick={() => {
            setDraft(blankIssue(detail.preparer?.userId));
            setRaising(true);
          }}
        >
          + Raise Issue
        </button>
      }
    >
      {q.isError ? (
        <p role="alert" className={quiet}>
          Validation issues are not available right now.
        </p>
      ) : !q.data?.length ? (
        <p className={quiet}>{q.isPending ? 'Loading…' : 'No validation issues.'}</p>
      ) : (
        <>
          {errors ? (
            <p className="text-sm font-semibold text-danger" data-testid="issues-blocking">
              {errors === 1
                ? '1 open error blocks Ready to File and filing.'
                : `${errors} open errors block Ready to File and filing.`}
            </p>
          ) : null}
          <ul className="flex flex-col divide-y divide-divider rounded-lg border border-divider text-sm">
            {q.data.map((i) => (
              <li key={i.id} className="flex min-w-0 flex-col gap-1 px-3 py-2" data-testid="issue">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={SEVERITY[i.severity].tone}>{SEVERITY[i.severity].label}</Badge>
                  {i.resolvedAt ? (
                    <Badge tone="success" icon={CheckCircle}>
                      Resolved
                    </Badge>
                  ) : null}
                </span>
                <span
                  className={`whitespace-pre-wrap wrap-anywhere ${i.resolvedAt ? 'text-muted' : 'text-text'}`}
                >
                  {i.note}
                </span>
                <span className="text-xs wrap-anywhere text-muted">
                  Responsible: {i.responsible?.name ?? 'No one yet'}
                  {i.draft ? ` · Version: ${i.draft.fileName}` : ''}
                  {i.step ? ` · Line: ${i.step.label}` : ''}
                </span>
                <span className="text-xs text-muted">
                  Raised by {i.raisedBy?.name ?? 'a member'}, {dateTimeText(i.createdAt)}
                  {i.resolvedAt
                    ? ` · Resolved by ${i.resolvedBy?.name ?? 'a member'}, ${dateTimeText(i.resolvedAt)}`
                    : ''}
                </span>
                <span className="flex flex-wrap gap-x-3">
                  {i.canResolve ? (
                    <button
                      type="button"
                      className={textButton}
                      onClick={() => {
                        if (i.resolvedAt) {
                          void act(
                            () =>
                              api.taxReturnWorkspace.updateIssue(detail.id, i.id, {
                                resolved: false,
                              }),
                            'Issue reopened.',
                          );
                          return;
                        }
                        setResolution('FIXED');
                        setReason('');
                        setResolving(i);
                      }}
                    >
                      {i.resolvedAt ? 'Reopen' : 'Resolve'}
                    </button>
                  ) : null}
                  {!i.resolvedAt ? (
                    <button
                      type="button"
                      className={textButton}
                      onClick={() => {
                        setTo(i.responsible?.userId ?? '');
                        setHanding(i);
                      }}
                    >
                      Reassign
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <ResolveRule />
      <p className="text-xs text-muted">
        Recorded by the firm&apos;s review; not a provider&apos;s or the IRS&apos;s validation.
      </p>
      {resolving ? (
        <Dialog
          title="Resolve Issue"
          confirm="Resolve"
          disabled={!reason.trim()}
          onConfirm={() =>
            void act(
              () =>
                api.taxReturnWorkspace.updateIssue(detail.id, resolving.id, {
                  resolved: true,
                  resolution,
                  reason: reason.trim(),
                }),
              'Issue resolved.',
            ).then((r) => {
              if (r) setResolving(undefined);
            })
          }
          onClose={() => setResolving(undefined)}
          testId="resolve-issue-dialog"
        >
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-semibold text-heading">How it was resolved</legend>
            <Radio
              label="Fixed: corrected on the return"
              name="resolution"
              value="FIXED"
              checked={resolution === 'FIXED'}
              onChange={() => setResolution('FIXED')}
            />
            <Radio
              label="Valid: checked, it needs no change"
              name="resolution"
              value="VALID"
              checked={resolution === 'VALID'}
              onChange={() => setResolution('VALID')}
            />
          </fieldset>
          <Textarea
            label="Reason (kept in the return's history)"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
          {resolving.severity === 'ERROR' && pastReview(detail.workflowStatus) ? (
            <p role="note" className="rounded-lg bg-warning-soft p-2 text-sm text-heading">
              The return goes back to Ready for Review for the reviewer&apos;s approval.
            </p>
          ) : null}
        </Dialog>
      ) : null}
      {raising ? (
        <Dialog
          title="Raise Validation Issue"
          confirm="Raise Issue"
          disabled={!draft.note.trim()}
          onConfirm={() =>
            void act(
              () => api.taxReturnWorkspace.raiseIssue(detail.id, issueBody(draft)),
              'Issue raised.',
            ).then((r) => {
              if (r) setRaising(false);
            })
          }
          onClose={() => setRaising(false)}
          testId="raise-issue-dialog"
        >
          <IssueFields returnId={detail.id} value={draft} onChange={setDraft} />
        </Dialog>
      ) : null}
      {handing ? (
        <Dialog
          title="Reassign Issue"
          confirm="Reassign"
          disabled={to === (handing.responsible?.userId ?? '')}
          onConfirm={() =>
            void act(
              () =>
                api.taxReturnWorkspace.updateIssue(detail.id, handing.id, {
                  responsibleUserId: to || null,
                }),
              'Issue reassigned.',
            ).then((r) => {
              if (r) setHanding(undefined);
            })
          }
          onClose={() => setHanding(undefined)}
          testId="reassign-issue-dialog"
        >
          <Select
            label="Responsible person"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            options={[{ value: '', label: 'No one yet' }, ...members]}
          />
        </Dialog>
      ) : null}
    </Panel>
  );
}
