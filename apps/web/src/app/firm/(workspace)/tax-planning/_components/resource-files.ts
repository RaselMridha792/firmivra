import type { PlanningResource } from '@firmivra/types';

/**
 * Tax Planning resources (audit, Nov 20): Download and Print for a planning resource: its title,
 * category and kind, the summary, and what it contains (a checklist's lines as boxes to tick).
 * Built in the browser from what the list already shows; nothing is sent.
 */
const lines = (r: PlanningResource) => (r.body ?? '').split(/\r?\n/).filter((l) => l.trim());
const kindWord = (r: PlanningResource) => r.kind.charAt(0) + r.kind.slice(1).toLowerCase();

/** "year-end-tax-planning-checklist.txt" */
export const resourceFileName = (r: PlanningResource) =>
  `${
    r.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'resource'
  }.txt`;

/** The resource as plain text, as Download saves it. */
export function resourceText(r: PlanningResource): string {
  const checklist = r.kind === 'CHECKLIST';
  return [
    r.title,
    `${r.category} · ${kindWord(r)}`,
    '',
    ...(r.summary ? [r.summary, ''] : []),
    ...lines(r).map((l) => (checklist ? `[ ] ${l.trim()}` : l)),
  ]
    .join('\n')
    .trimEnd()
    .concat('\n');
}

export function downloadResource(r: PlanningResource): void {
  const url = URL.createObjectURL(new Blob([resourceText(r)], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = resourceFileName(r);
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const escape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** The resource as a printable page (every value escaped). */
export function resourceHtml(r: PlanningResource): string {
  const checklist = r.kind === 'CHECKLIST';
  const items = lines(r)
    .map((l) => `<li>${checklist ? '&#9744; ' : ''}${escape(l.trim())}</li>`)
    .join('');
  return [
    `<!doctype html><html><head><meta charset="utf-8"><title>${escape(r.title)}</title>`,
    '<style>body{font:14px/1.5 system-ui,sans-serif;margin:32px}ul{list-style:none;padding:0}li{margin:6px 0}</style>',
    `</head><body><h1>${escape(r.title)}</h1><p>${escape(`${r.category} · ${kindWord(r)}`)}</p>`,
    r.summary ? `<p>${escape(r.summary)}</p>` : '',
    items ? `<ul>${items}</ul>` : '',
    '</body></html>',
  ].join('');
}

/** Prints the resource from a frame of its own, which runs nothing and may only print. */
export function printResource(r: PlanningResource): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.srcdoc = resourceHtml(r);
  frame.onload = () => {
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1_000);
  };
  document.body.append(frame);
}
