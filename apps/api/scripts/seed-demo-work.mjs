// Fills the demo firm's Tasks screens through the API itself (so every rule runs): task types,
// templates with checklists, and recurring series for a few clients. Run it against a local API
// (AUTH_MODE=local) after `pnpm db:seed:demo`:
//
//   node apps/api/scripts/seed-demo-work.mjs <demo business id> [owner email] [api base]
//
// Safe to run again: a name that exists is left alone. Synthetic data only.
const BIZ = process.argv[2];
const EMAIL = process.argv[3] ?? 'owner@demo.test';
const API = process.argv[4] ?? 'http://localhost:4550/api/v1';
if (!BIZ) throw new Error('Pass the demo business id');

let n = 0;
const ip = () => `198.71.${Math.floor(n / 250)}.${(n++ % 250) + 1}, 10.0.0.5`;
const token = (
  await (
    await fetch(`${API}/dev/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() },
      body: JSON.stringify({ email: EMAIL }),
    })
  ).json()
).token;

async function call(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'x-business-id': BIZ,
      'x-forwarded-for': ip(),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json };
}
const must = (label, r) => {
  if (r.status >= 400)
    throw new Error(`${label}: ${r.status} ${JSON.stringify(r.json?.error ?? r.json)}`);
  return r.json;
};

const today = new Date();
const day = (offset) => new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

// Task types
const have = (await call('GET', '/business/task-types')).json?.items ?? [];
const typeIds = {};
for (const name of ['Tax Return', 'Bookkeeping', 'Client Follow-Up', 'Payroll', 'Compliance']) {
  const found = have.find((t) => t.name === name);
  typeIds[name] = found
    ? found.id
    : must(`type ${name}`, await call('POST', '/business/task-types', { name })).id;
}

// Templates
const tpls = (await call('GET', '/business/task-templates')).json?.items ?? [];
const templates = [
  {
    name: 'Individual return intake',
    description: 'Collect what is needed to start an individual return.',
    typeId: typeIds['Tax Return'],
    priority: 'HIGH',
    dueOffsetDays: 14,
    checklist: [
      { label: 'Request last year return', required: true },
      { label: 'Collect W-2 and 1099 forms', required: true },
      { label: 'Confirm dependents', required: false },
    ],
  },
  {
    name: 'Monthly bookkeeping close',
    description: 'Reconcile accounts and send the monthly summary.',
    typeId: typeIds['Bookkeeping'],
    priority: 'MEDIUM',
    dueOffsetDays: 10,
    checklist: [
      { label: 'Import bank transactions', required: true },
      { label: 'Categorize uncategorized items', required: true },
      { label: 'Reconcile accounts', required: true },
      { label: 'Send summary to client', required: false },
    ],
  },
  {
    name: 'Quarterly estimated tax reminder',
    description: 'Remind the client about the next estimated payment.',
    typeId: typeIds['Client Follow-Up'],
    priority: 'MEDIUM',
    dueOffsetDays: 7,
    clientVisibleDefault: true,
    checklist: [{ label: 'Calculate the payment', required: true }],
  },
];
const madeTemplates = {};
for (const t of templates) {
  const found = tpls.find((x) => x.name === t.name);
  madeTemplates[t.name] = found
    ? found.id
    : must(`template ${t.name}`, await call('POST', '/business/task-templates', t)).id;
}

// Series for the first clients
const clients = must('clients', await call('GET', '/business/clients?limit=3')).items ?? [];
const existing = (await call('GET', '/business/task-series')).json?.items ?? [];
let made = 0;
for (const [i, c] of clients.entries()) {
  const title =
    i === 0
      ? 'Monthly bookkeeping close'
      : i === 1
        ? 'Quarterly estimated tax reminder'
        : 'Weekly check-in';
  if (existing.some((s) => s.title === title && s.client?.id === c.id)) continue;
  must(
    `series ${title}`,
    await call('POST', '/business/task-series', {
      clientId: c.id,
      title,
      details: 'Created for the demo.',
      priority: 'MEDIUM',
      typeId: typeIds[i === 0 ? 'Bookkeeping' : 'Client Follow-Up'],
      ...(i < 2 ? { templateId: madeTemplates[title] } : {}),
      recurrence: {
        interval: 1,
        unit: i === 1 ? 'QUARTER' : i === 0 ? 'MONTH' : 'WEEK',
        pattern: i === 2 ? { weekdays: [1] } : {},
        endMode: 'NEVER',
        startOn: day(i === 2 ? 3 : 10),
      },
    }),
  );
  made++;
}
console.log(
  `Types: ${Object.keys(typeIds).length}, templates: ${Object.keys(madeTemplates).length}, new series: ${made}.`,
);
