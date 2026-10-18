// Fills the demo firm's Tasks and Tax Planning screens through the API itself (so every rule
// runs): task types, templates with checklists, recurring series for a few clients, planning
// strategies, tax plans with strategies, and opportunities. Run it against a local API
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

// ---------- Tax Planning ----------
const strategies = (await call('GET', '/business/tax-planning/strategies')).json?.items ?? [];
const strategyIds = {};
for (const st of [
  {
    name: 'Maximize retirement contributions',
    category: 'RETIREMENT',
    description: 'Use the available employer plan and IRA room before the year ends.',
    defaultPriority: 'HIGH',
    requiredInputs: ['wages', 'retirement_contributions'],
    implementationChecklist: [
      'Confirm current contributions',
      'Set the new deferral',
      'Document the change',
    ],
  },
  {
    name: 'Bunch itemized deductions',
    category: 'DEDUCTIONS',
    description: 'Group deductible payments into one year to pass the standard deduction.',
    defaultPriority: 'MEDIUM',
    requiredDocuments: ['Mortgage interest statement', 'Charitable receipts'],
  },
  {
    name: 'Review the business entity type',
    category: 'ENTITY',
    description: 'Compare sole proprietor, LLC and S corporation treatment.',
    defaultPriority: 'MEDIUM',
  },
]) {
  const found = strategies.find((x) => x.name === st.name);
  strategyIds[st.name] = found
    ? found.id
    : must(`strategy ${st.name}`, await call('POST', '/business/tax-planning/strategies', st)).id;
}
const plans = (await call('GET', '/business/tax-planning/plans')).json?.items ?? [];
let newPlans = 0;
for (const [i, c] of clients.slice(0, 2).entries()) {
  const name = i === 0 ? '2026 comprehensive plan' : '2026 retirement plan';
  if (plans.some((p) => p.name === name && p.client?.id === c.id)) continue;
  const plan = must(
    `plan ${name}`,
    await call('POST', '/business/tax-planning/plans', {
      clientId: c.id,
      planYear: 2026,
      name,
      planType: i === 0 ? 'COMPREHENSIVE' : 'FOCUSED',
      filingStatus: i === 0 ? 'MARRIED_FILING_JOINTLY' : 'SINGLE',
      goals: ['REDUCE_TAXABLE_INCOME', 'INCREASE_RETIREMENT_SAVINGS'],
      allowDuplicate: true,
    }),
  );
  must(
    `strategy on ${name}`,
    await call('POST', `/business/tax-planning/plans/${plan.id}/strategies`, {
      kind: 'LIBRARY',
      strategyId: strategyIds['Maximize retirement contributions'],
    }),
  );
  newPlans++;
}
const opps = (await call('GET', '/business/tax-planning/opportunities')).json?.items ?? [];
let newOpps = 0;
for (const [i, c] of clients.slice(0, 3).entries()) {
  const name = [
    'Retirement contribution room',
    'Itemized deduction bunching',
    'Entity type review',
  ][i];
  if (opps.some((o) => o.name === name && o.client?.id === c.id)) continue;
  must(
    `opportunity ${name}`,
    await call('POST', '/business/tax-planning/opportunities', {
      clientId: c.id,
      strategyId: Object.values(strategyIds)[i],
      name,
      category: ['RETIREMENT', 'DEDUCTIONS', 'ENTITY'][i],
      priority: i === 0 ? 'HIGH' : 'MEDIUM',
      taxYear: 2026,
      description: 'Created for the demo.',
      estimatedSavingsCents: [320_000, 150_000, 480_000][i],
      estimateBasis: 'A rough estimate from the demo figures.',
      recommendedActions: ['Review with the client', 'Confirm the figures'],
    }),
  );
  newOpps++;
}
console.log(
  `Tax planning: ${Object.keys(strategyIds).length} strategies, ${newPlans} new plans, ${newOpps} new opportunities.`,
);
