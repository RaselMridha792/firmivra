export type Status = 'Pending Review' | 'Information Requested' | 'Approved' | 'Declined';
export type Action = 'Approve' | 'Request Information' | 'Decline';
export type Entry = { title: string; detail: string; at: string };
export type Note = { id: string; text: string };
export type Application = {
  id: string;
  name: string;
  status: Status;
  submittedAt: string;
  owner: string;
  email: string;
  phone: string;
  services: string[];
  sections: Record<string, Record<string, string>>;
  documents: string[];
  checks: string[];
  notes: Note[];
  history: Entry[];
};

const rows: Application[] = Array.from({ length: 13 }, (_, i) => {
  const n = i + 1,
    owner = n === 1 ? 'Morgan Lee' : `Taylor Morgan ${n}`;
  const email = n === 1 ? 'morgan.lee@example.test' : `owner${n}@example.test`;
  const submittedAt = new Date(Date.UTC(2026, 9, 6 - i, 10, 24)).toISOString();
  const name = n === 1 ? 'Northstar Tax Studio' : `Northstar Advisory ${n}`;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    name,
    status: n === 1 || n > 7 ? 'Pending Review' : n < 6 ? 'Approved' : 'Declined',
    submittedAt,
    owner,
    email,
    phone: `202-555-${1000 + n}`,
    services: ['Tax Preparation', 'Bookkeeping', 'Payroll', 'Business Consulting'],
    sections: {
      'Business Information': {
        'Business name': name,
        DBA: n === 1 ? 'Northstar Tax' : `Northstar ${n}`,
        'Business type': 'LLC',
        'Services offered': 'Tax Preparation, Bookkeeping, Payroll, Business Consulting',
        EIN: '••••6789',
        Website: 'northstar.example.test',
        'Business address': '123 Example Ave, Testville, NY 10001',
        'Agreement accepted': 'Yes',
        'Certification accepted': 'Yes',
      },
      'Primary Administrator': {
        'Full name': owner,
        Email: email,
        Phone: `202-555-${1000 + n}`,
        'Title / role': 'Owner',
        'Preferred contact': 'Email',
        'Alternate phone': 'Not provided',
      },
      'Account Details': {
        'Requested plan': 'Professional (Beta)',
        'Estimated team size': '3',
        'Estimated client volume': '500+',
        'Referral source': 'Direct Request',
        'Requested start': 'As soon as possible',
        'Additional information': 'Synthetic example for review.',
      },
    },
    documents: [],
    checks: [],
    notes: [],
    history: [
      { title: 'Application Submitted', detail: `Received from ${owner}.`, at: submittedAt },
    ],
  };
});

let version = 0,
  noteId = 0;
const listeners = new Set<() => void>();
export const revision = () => version;
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const changed = () => {
  version++;
  listeners.forEach((listener) => listener());
};
const copy = (a: Application): Application => ({
  ...a,
  services: [...a.services],
  sections: Object.fromEntries(Object.entries(a.sections).map(([k, v]) => [k, { ...v }])),
  documents: [...a.documents],
  checks: [...a.checks],
  notes: [...a.notes],
  history: [...a.history],
});
export const listApplications = () => rows.map(copy);
export const findApplication = (id: string) => {
  const a = rows.find((item) => item.id === id);
  return a && copy(a);
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 180));
export async function decide(id: string, action: Action, detail: string) {
  await pause();
  const a = rows.find((item) => item.id === id);
  if (!a) throw new Error('Not found');
  a.status =
    action === 'Approve' ? 'Approved' : action === 'Decline' ? 'Declined' : 'Information Requested';
  a.history.push({
    title: action,
    detail: detail || 'Application approved.',
    at: new Date().toISOString(),
  });
  changed();
  return copy(a);
}
export async function addNote(id: string, text: string) {
  await pause();
  const a = rows.find((item) => item.id === id);
  if (!a) throw new Error('Not found');
  a.notes.push({ id: `note-${++noteId}`, text });
  a.history.push({ title: 'Internal Note Added', detail: text, at: new Date().toISOString() });
  changed();
  return copy(a);
}
