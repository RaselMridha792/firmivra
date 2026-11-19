/** Create Task for a client, its service and period (SH4): `/tasks/new` fills these in. */
export function newTaskHref(context: {
  clientId: string;
  engagementId?: string;
  period?: string;
  /** I-P01: the invoice it is about ("INV-2026-0106"): the name and details say so. */
  invoice?: string;
  /** Tax Returns Review Two F03 (R56): the exact tax return it is about. */
  taxReturnId?: string;
}): string {
  const params = new URLSearchParams({ clientId: context.clientId });
  if (context.engagementId) params.set('engagementId', context.engagementId);
  if (context.period) params.set('period', context.period);
  if (context.invoice) params.set('invoice', context.invoice);
  if (context.taxReturnId) params.set('taxReturnId', context.taxReturnId);
  return `/tasks/new?${params.toString()}`;
}

/** Set up a recurring task on the same client and engagement (Review 2, Bookkeeping N05). */
export function recurringHref(clientId: string, engagementId: string): string {
  const params = new URLSearchParams();
  if (clientId) params.set('clientId', clientId);
  if (engagementId) params.set('engagementId', engagementId);
  const q = params.toString();
  return `/tasks/recurring/new${q ? `?${q}` : ''}`;
}

/** Where Related To opens: the engagement's own workspace (Review 2, Bookkeeping N05). */
export function workspacePath(
  workspace: { kind: 'BOOKKEEPING' | 'PAYROLL' | 'ADVISORY'; id: string } | null | undefined,
): string | null {
  if (!workspace) return null;
  if (workspace.kind === 'BOOKKEEPING') return `/bookkeeping/clients/${workspace.id}`;
  if (workspace.kind === 'PAYROLL') return `/payroll/clients/${workspace.id}`;
  return `/business-advisory/clients/${workspace.id}`;
}

/**
 * T-C10: Related To as one choice of the form: `engagement:<id>`, `taxPlan:<id>`,
 * `deadline:<id>`, `custom` (a note, not a record) or '' (none).
 */
export type RelatedKind = 'engagement' | 'taxPlan' | 'deadline' | 'custom' | '';
export function splitRelated(choice: string): { kind: RelatedKind; id: string } {
  if (choice === 'custom') return { kind: 'custom', id: '' };
  const at = choice.indexOf(':');
  const kind = choice.slice(0, at);
  return kind === 'engagement' || kind === 'taxPlan' || kind === 'deadline'
    ? { kind, id: choice.slice(at + 1) }
    : { kind: '', id: '' };
}

interface Related {
  engagement: {
    id: string;
    title: string;
    workspace?: { kind: 'BOOKKEEPING' | 'PAYROLL' | 'ADVISORY'; id: string } | null;
  } | null;
  taxPlan: { id: string; name: string } | null;
  deadline: { id: string; name: string } | null;
  /** Tax Returns Review Two F03 (R56): the exact tax return. */
  taxReturn?: { id: string; name: string } | null;
  relatedText: string | null;
}

/** The choice a task or draft starts the form with: its record, else its custom note. */
export function relatedChoice(t: Related): string {
  if (t.engagement) return `engagement:${t.engagement.id}`;
  if (t.taxPlan) return `taxPlan:${t.taxPlan.id}`;
  if (t.deadline) return `deadline:${t.deadline.id}`;
  return t.relatedText ? 'custom' : '';
}

/**
 * Each Related To a task has, the records first with the page that opens them (an engagement's
 * workspace, the plan, the deadline), then the custom note, labelled as one and never a link.
 */
export function relatedLinks(
  t: Related,
): { key: string; label: string; href: string | null; custom: boolean }[] {
  const out: { key: string; label: string; href: string | null; custom: boolean }[] = [];
  if (t.engagement)
    out.push({
      key: 'engagement',
      label: t.engagement.title,
      href: workspacePath(t.engagement.workspace),
      custom: false,
    });
  // F03 (R56): the exact tax return, opening that return.
  if (t.taxReturn)
    out.push({
      key: 'taxReturn',
      label: t.taxReturn.name,
      href: `/tax-returns/${t.taxReturn.id}`,
      custom: false,
    });
  if (t.taxPlan)
    out.push({
      key: 'taxPlan',
      label: `Tax plan: ${t.taxPlan.name}`,
      href: `/tax-planning/plans/${t.taxPlan.id}`,
      custom: false,
    });
  if (t.deadline)
    out.push({
      key: 'deadline',
      label: `Deadline: ${t.deadline.name}`,
      href: `/compliance/${t.deadline.id}`,
      custom: false,
    });
  if (t.relatedText)
    out.push({ key: 'custom', label: `Custom: ${t.relatedText}`, href: null, custom: true });
  return out;
}

/** Related To in one line (the table's column), never the Service in its place. */
export const relatedLabel = (t: Related): string =>
  relatedLinks(t)
    .map((l) => l.label)
    .join(' · ') || '—';
