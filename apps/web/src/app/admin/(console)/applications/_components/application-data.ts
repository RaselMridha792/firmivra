export type ApplicationStatus =
  'Pending Review' | 'Information Requested' | 'Approved' | 'Declined';

export type ApplicationAction = 'Approve' | 'Request Information' | 'Decline';

export type HistoryEntry = {
  title: string;
  detail: string;
  at: string;
};

export type ApplicationNote = { id: string; text: string };

export type FirmApplication = {
  id: string;
  businessName: string;
  dba: string;
  businessType: string;
  einLast4: string;
  website: string;
  address: string;
  services: string[];
  ownerName: string;
  email: string;
  phone: string;
  ownerRole: string;
  contactMethod: string;
  alternatePhone: string;
  requestedPlan: string;
  teamSize: string;
  clientVolume: string;
  referralSource: string;
  requestedStart: string;
  additionalInfo: string;
  agreementAccepted: boolean;
  certificationAccepted: boolean;
  status: ApplicationStatus;
  submittedAt: string;
  documents: string[];
  checks: string[];
  notes: ApplicationNote[];
  history: HistoryEntry[];
};

// Synthetic screen fixture until R4's api.firmApplications client is available on main.
const records: FirmApplication[] = Array.from({ length: 13 }, (_, index) => {
  const n = index + 1;
  const submittedAt = new Date(Date.UTC(2026, 9, 6 - index, 10, 24)).toISOString();
  const status: ApplicationStatus =
    n === 1 || n > 7 ? 'Pending Review' : n < 6 ? 'Approved' : 'Declined';
  const ownerName = n === 1 ? 'Morgan Lee' : `Taylor Morgan ${n}`;

  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    businessName: n === 1 ? 'Northstar Tax Studio' : `Northstar Advisory ${n}`,
    dba: n === 1 ? 'Northstar Tax' : `Northstar ${n}`,
    businessType: 'LLC',
    einLast4: '6789',
    website: 'northstar.example.test',
    address: '123 Example Ave, Testville, NY 10001',
    services: ['Tax Preparation', 'Bookkeeping', 'Payroll', 'Business Consulting'],
    ownerName,
    email: n === 1 ? 'morgan.lee@example.test' : `owner${n}@example.test`,
    phone: `202-555-${String(1000 + n).slice(-4)}`,
    ownerRole: 'Owner',
    contactMethod: 'Email',
    alternatePhone: 'Not provided',
    requestedPlan: 'Professional (Beta)',
    teamSize: '3',
    clientVolume: '500+',
    referralSource: 'Direct Request',
    requestedStart: 'As soon as possible',
    additionalInfo: 'Synthetic example for application review.',
    agreementAccepted: true,
    certificationAccepted: true,
    status,
    submittedAt,
    documents: [],
    checks: [],
    notes: [],
    history: [
      {
        title: 'Application Submitted',
        detail: `Received from ${ownerName}.`,
        at: submittedAt,
      },
    ],
  };
});

let version = 0;
let noteSequence = 0;
const listeners = new Set<() => void>();

export const getApplicationsVersion = () => version;
export function subscribeApplications(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function notifyApplicationsChanged() {
  version += 1;
  listeners.forEach((listener) => listener());
}

const copy = (row: FirmApplication): FirmApplication => ({
  ...row,
  services: [...row.services],
  documents: [...row.documents],
  checks: [...row.checks],
  notes: [...row.notes],
  history: row.history.map((event) => ({ ...event })),
});

const pause = () => new Promise((resolve) => setTimeout(resolve, 180));

export function listApplications() {
  return records.map(copy);
}

export function findApplication(id: string) {
  const row = records.find((item) => item.id === id);
  return row ? copy(row) : undefined;
}

export async function decideApplication(id: string, action: ApplicationAction, detail = '') {
  await pause();
  const row = records.find((item) => item.id === id);
  if (!row) throw new Error('Application not found');

  row.status =
    action === 'Approve' ? 'Approved' : action === 'Decline' ? 'Declined' : 'Information Requested';
  row.history = [
    ...row.history,
    {
      title: action,
      detail: detail || 'Application approved.',
      at: new Date().toISOString(),
    },
  ];
  notifyApplicationsChanged();
  return copy(row);
}

export async function addApplicationNote(id: string, note: string) {
  await pause();
  const row = records.find((item) => item.id === id);
  if (!row) throw new Error('Application not found');

  row.notes = [...row.notes, { id: `mock-note-${++noteSequence}`, text: note }];
  row.history = [
    ...row.history,
    { title: 'Internal Note Added', detail: note, at: new Date().toISOString() },
  ];
  notifyApplicationsChanged();
  return copy(row);
}
