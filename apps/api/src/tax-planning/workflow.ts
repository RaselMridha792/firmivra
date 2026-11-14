import type { PlanAction, PlanReadinessItem } from '@firmivra/types';

// Tax Planning Review 2's approved workflow: where a plan stands, what comes next and whose it
// is, the readiness checklist (done or missing, and how to fix it) and the actions that fit now.
// Plain functions of the plan's facts, so the detail, the lists and the tests read the same rule.
//
// The refined flow: Draft or Scheduled (set up: assignee, target date, client discussions) → In
// Progress (work begins by itself on the first change) → Under Review (internal, a chosen
// reviewer; optional, any time) → Finalized → Awaiting Client Review (sent for review) → Needs
// Review (the client asked something) → In Progress (revision) → sent again → Client Approved
// (an exact version, recorded) → Implemented (only after approval). Deliver to Client is a step of
// its own, after approval, apart from Implemented. Closed is read-only until Reopen.

export interface WorkflowFacts {
  status: string;
  /** The caller may change the plan / send it. */
  canEdit: boolean;
  canSend: boolean;
  assigned: boolean;
  targetSet: boolean;
  discussions: number;
  /** What keeps it from being finalized (each says where to fix it). */
  finalBlockers: string[];
  /** The newest finalized version still matches the plan. */
  finalizedCurrent: boolean;
  /** The newest version sent for review, and the newest the client approved. */
  sentVersion: number | null;
  approvedVersion: number | null;
  delivered: boolean;
  openClientRequests: number;
}

export interface WorkflowView {
  nextAction: string;
  /** Who acts next: the assignee, the reviewer, or (null) the client or nobody. */
  ownerIs: 'ASSIGNEE' | 'REVIEWER' | 'NONE';
  waitingOnClient: boolean;
  actions: PlanAction[];
  readiness: PlanReadinessItem[];
}

/** The client approved the version sent for review (not an earlier one). */
export const approvedCurrent = (f: Pick<WorkflowFacts, 'sentVersion' | 'approvedVersion'>) =>
  f.sentVersion !== null && f.approvedVersion !== null && f.approvedVersion >= f.sentVersion;

export function readinessOf(f: WorkflowFacts): PlanReadinessItem[] {
  const item = (key: string, label: string, done: boolean, fix: string): PlanReadinessItem => ({
    key,
    label,
    done,
    fix: done ? null : fix,
  });
  const strategyBlocker = f.finalBlockers.find((m) => m.startsWith('Select at least one'));
  const staleBlockers = f.finalBlockers.filter((m) => !m.startsWith('Select at least one'));
  return [
    item(
      'assigned',
      'Assigned to a team member',
      f.assigned,
      'Choose who owns it in Edit Planning.',
    ),
    item(
      'target',
      'Target completion date set',
      f.targetSet,
      'Set the target date in Edit Planning.',
    ),
    item(
      'discussion',
      'A client discussion scheduled',
      f.discussions > 0,
      'Use Schedule Client Discussion in Implementation.',
    ),
    item(
      'strategy',
      'At least one strategy selected',
      !strategyBlocker,
      strategyBlocker ?? 'Select a strategy in Goals & Strategies.',
    ),
    item(
      'figures',
      'Financial figures current',
      staleBlockers.length === 0,
      staleBlockers.join(' '),
    ),
    item(
      'finalized',
      'Finalized after the last change',
      f.finalizedCurrent,
      'Use Finalize Plan in Review & Save.',
    ),
    item(
      'sent',
      'Sent to the client for review',
      f.sentVersion !== null,
      'Use Send to Client once it is finalized.',
    ),
    item(
      'approved',
      'Client approval of the sent version recorded',
      approvedCurrent(f),
      'Use Record Client Approval with the date and how it was given.',
    ),
    item(
      'delivered',
      'Delivered to the client',
      f.delivered,
      'Use Deliver to Client after approval.',
    ),
  ];
}

export function workflowOf(f: WorkflowFacts): WorkflowView {
  const readiness = readinessOf(f);
  const firstMissing = readiness.find((r) => !r.done && r.key !== 'sent' && r.key !== 'approved');
  const edit = f.canEdit;
  const send = f.canSend;
  const pick = (...a: (PlanAction | false)[]) => a.filter((x): x is PlanAction => x !== false);
  const common = pick(edit && 'CLOSE', edit && 'DUPLICATE');
  switch (f.status) {
    case 'DRAFT':
    case 'SCHEDULED':
      return {
        nextAction:
          f.status === 'DRAFT'
            ? 'Set the plan up: assign it, set the target date and schedule a client discussion.'
            : 'Hold the client discussion, then start the work.',
        ownerIs: 'ASSIGNEE',
        waitingOnClient: false,
        actions: pick(edit && 'START_WORK', ...common),
        readiness,
      };
    case 'IN_PROGRESS':
      return {
        nextAction: firstMissing
          ? `${firstMissing.label}: ${firstMissing.fix}`
          : 'Send it for internal review, or send it to the client for review.',
        ownerIs: 'ASSIGNEE',
        waitingOnClient: false,
        actions: pick(
          edit && 'SEND_FOR_REVIEW',
          edit && 'FINALIZE',
          send && 'SEND_TO_CLIENT',
          edit && 'REQUEST_INFORMATION',
          ...common,
        ),
        readiness,
      };
    case 'UNDER_REVIEW':
      return {
        nextAction: 'Review the plan, then return it to work or send it to the client for review.',
        ownerIs: 'REVIEWER',
        waitingOnClient: false,
        actions: pick(
          edit && 'RETURN_TO_WORK',
          edit && 'FINALIZE',
          send && 'SEND_TO_CLIENT',
          ...common,
        ),
        readiness,
      };
    case 'FINALIZED':
      return {
        nextAction: 'Send it to the client for review.',
        ownerIs: 'ASSIGNEE',
        waitingOnClient: false,
        actions: pick(
          send && 'SEND_TO_CLIENT',
          edit && 'SEND_FOR_REVIEW',
          edit && 'REVISE',
          ...common,
        ),
        readiness,
      };
    case 'AWAITING_CLIENT':
      return {
        nextAction: `Waiting for the client to review version ${f.sentVersion ?? 1}: record their approval or what they asked.`,
        ownerIs: 'NONE',
        waitingOnClient: true,
        actions: pick(
          edit && 'RECORD_APPROVAL',
          edit && 'RECORD_CLIENT_REQUEST',
          edit && 'REQUEST_INFORMATION',
          edit && 'REVISE',
          ...common,
        ),
        readiness,
      };
    case 'READY_FOR_REVIEW':
      return {
        nextAction:
          f.openClientRequests > 0
            ? `Answer the client's ${f.openClientRequests === 1 ? 'request' : `${f.openClientRequests} requests`}: start the revision.`
            : "Answer the client's request: start the revision.",
        ownerIs: 'ASSIGNEE',
        waitingOnClient: false,
        actions: pick(edit && 'START_REVISION', edit && 'REQUEST_INFORMATION', ...common),
        readiness,
      };
    case 'CLIENT_APPROVED':
      return {
        nextAction: f.delivered
          ? 'Put the approved plan into action, then mark it Implemented.'
          : 'Deliver the approved plan to the client, and put it into action.',
        ownerIs: 'ASSIGNEE',
        waitingOnClient: false,
        actions: pick(
          edit && 'MARK_IMPLEMENTED',
          send && !f.delivered && 'DELIVER',
          edit && 'REVISE',
          ...common,
        ),
        readiness,
      };
    case 'IMPLEMENTED':
      return {
        nextAction: f.delivered
          ? 'Close the plan when the work is done.'
          : 'Deliver the approved plan to the client.',
        ownerIs: 'ASSIGNEE',
        waitingOnClient: false,
        actions: pick(send && !f.delivered && 'DELIVER', edit && 'REVISE', ...common),
        readiness,
      };
    case 'CLOSED':
      return {
        nextAction: 'Closed: reopen it, with the reason, to change it.',
        ownerIs: 'NONE',
        waitingOnClient: false,
        actions: pick(edit && 'REOPEN', edit && 'DUPLICATE'),
        readiness,
      };
    default:
      return {
        nextAction: '',
        ownerIs: 'NONE',
        waitingOnClient: false,
        actions: common,
        readiness,
      };
  }
}
