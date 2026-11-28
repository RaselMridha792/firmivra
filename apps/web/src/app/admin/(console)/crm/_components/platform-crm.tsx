'use client';

import { Badge, Button, Card, Input, Modal, Select, Table, Toast, type Column } from '@firmivra/ui';
import { Building2, CalendarCheck, CheckCircle2, Plus, TrendingUp } from 'lucide-react';
import { useState } from 'react';

export type ProspectiveFirmStage =
  'NEW' | 'CONTACTED' | 'DEMO_SCHEDULED' | 'PROPOSAL_SENT' | 'WON' | 'LOST';

export interface ProspectiveFirmLead {
  id: string;
  firmName: string;
  contactName: string;
  email: string;
  phone: string;
  estimatedStaff: number;
  targetTier: 'SOLO' | 'TEAM_PRO' | 'BUSINESS' | 'ENTERPRISE';
  stage: ProspectiveFirmStage;
  notes: string;
  lastContactAt: string;
}

const STAGE_LABELS: Record<
  ProspectiveFirmStage,
  { label: string; tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  NEW: { label: 'New Lead', tone: 'info' },
  CONTACTED: { label: 'Contacted', tone: 'neutral' },
  DEMO_SCHEDULED: { label: 'Demo Scheduled', tone: 'warning' },
  PROPOSAL_SENT: { label: 'Proposal Sent', tone: 'warning' },
  WON: { label: 'Won / Signed Up', tone: 'success' },
  LOST: { label: 'Lost / Disqualified', tone: 'danger' },
};

const INITIAL_PROSPECTIVE_FIRMS: ProspectiveFirmLead[] = [
  {
    id: 'lead-1',
    firmName: 'Apex Tax & Advisory Partners',
    contactName: 'Robert Vance, CPA',
    email: 'rvance@apextaxpartners.test',
    phone: '(555) 234-5678',
    estimatedStaff: 12,
    targetTier: 'TEAM_PRO',
    stage: 'DEMO_SCHEDULED',
    notes: 'Interested in E-Sign and Client Portal features. Scheduled product demo for Friday.',
    lastContactAt: '2026-11-26',
  },
  {
    id: 'lead-2',
    firmName: 'Summit Accounting LLC',
    contactName: 'Elena Rostova',
    email: 'elena@summitaccounting.test',
    phone: '(555) 345-6789',
    estimatedStaff: 4,
    targetTier: 'SOLO',
    stage: 'CONTACTED',
    notes: 'Looking to transition away from legacy desktop software.',
    lastContactAt: '2026-11-24',
  },
  {
    id: 'lead-3',
    firmName: 'Pinnacle Financial Advisors',
    contactName: 'Marcus Sterling',
    email: 'm.sterling@pinnaclefa.test',
    phone: '(555) 456-7890',
    estimatedStaff: 28,
    targetTier: 'ENTERPRISE',
    stage: 'PROPOSAL_SENT',
    notes: 'Custom enterprise SLA and multi-office rollout proposed.',
    lastContactAt: '2026-11-27',
  },
  {
    id: 'lead-4',
    firmName: 'Greenwood & Co CPAs',
    contactName: 'Chloe Greenwood',
    email: 'chloe@greenwoodcpas.test',
    phone: '(555) 567-8901',
    estimatedStaff: 8,
    targetTier: 'TEAM_PRO',
    stage: 'WON',
    notes: 'Submitted firm onboarding application. Approved.',
    lastContactAt: '2026-11-25',
  },
];

export function PlatformCrm() {
  const [leads, setLeads] = useState<ProspectiveFirmLead[]>(INITIAL_PROSPECTIVE_FIRMS);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingStage, setEditingStage] = useState<ProspectiveFirmLead | null>(null);
  const [newStage, setNewStage] = useState<ProspectiveFirmStage>('CONTACTED');
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error' }>();

  // Add form state
  const [firmName, setFirmName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [staffCount, setStaffCount] = useState(5);
  const [targetTier, setTargetTier] = useState<ProspectiveFirmLead['targetTier']>('TEAM_PRO');
  const [notes, setNotes] = useState('');

  function handleAdd() {
    if (!firmName.trim() || !contactName.trim() || !email.trim()) {
      setToast({ text: 'Please fill in all required fields', tone: 'error' });
      return;
    }

    const nextId = `lead-${leads.length + 1}`;
    const today = new Date().toISOString().slice(0, 10);
    const created: ProspectiveFirmLead = {
      id: nextId,
      firmName: firmName.trim(),
      contactName: contactName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      estimatedStaff: Number(staffCount) || 1,
      targetTier,
      stage: 'NEW',
      notes: notes.trim(),
      lastContactAt: today,
    };

    setLeads((prev) => [created, ...prev]);
    setAdding(false);
    resetForm();
    setToast({ text: `Added prospective firm lead: ${created.firmName}`, tone: 'success' });
  }

  function handleUpdateStage() {
    if (!editingStage) return;
    setLeads((prev) =>
      prev.map((l) =>
        l.id === editingStage.id
          ? { ...l, stage: newStage, lastContactAt: new Date().toISOString().slice(0, 10) }
          : l,
      ),
    );
    setToast({
      text: `Updated ${editingStage.firmName} stage to ${STAGE_LABELS[newStage].label}`,
      tone: 'success',
    });
    setEditingStage(null);
  }

  function resetForm() {
    setFirmName('');
    setContactName('');
    setEmail('');
    setPhone('');
    setStaffCount(5);
    setTargetTier('TEAM_PRO');
    setNotes('');
  }

  const filtered = leads.filter((l) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      l.firmName.toLowerCase().includes(q) ||
      l.contactName.toLowerCase().includes(q) ||
      l.email.toLowerCase().includes(q);
    const matchesStage = !stageFilter || l.stage === stageFilter;
    return matchesSearch && matchesStage;
  });

  const kpis = {
    total: leads.length,
    active: leads.filter((l) => l.stage !== 'WON' && l.stage !== 'LOST').length,
    demos: leads.filter((l) => l.stage === 'DEMO_SCHEDULED').length,
    won: leads.filter((l) => l.stage === 'WON').length,
  };

  const columns: Column<ProspectiveFirmLead>[] = [
    {
      id: 'firm',
      label: 'Prospective Firm',
      cell: (r) => (
        <div className="flex flex-col">
          <span className="font-semibold text-heading">{r.firmName}</span>
          <span className="text-xs text-muted">
            Target: {r.targetTier} ({r.estimatedStaff} staff)
          </span>
        </div>
      ),
    },
    {
      id: 'contact',
      label: 'Primary Contact',
      cell: (r) => (
        <div className="flex flex-col text-xs text-text">
          <span className="font-medium text-heading">{r.contactName}</span>
          <span className="text-muted">{r.email}</span>
          <span className="text-muted">{r.phone}</span>
        </div>
      ),
    },
    {
      id: 'stage',
      label: 'Pipeline Stage',
      cell: (r) => {
        const info = STAGE_LABELS[r.stage];
        return <Badge tone={info.tone}>{info.label}</Badge>;
      },
    },
    {
      id: 'date',
      label: 'Last Contact',
      cell: (r) => <span className="text-xs text-muted">{r.lastContactAt}</span>,
    },
    {
      id: 'actions',
      label: 'Actions',
      cell: (r) => (
        <Button
          variant="secondary"
          className="text-xs"
          onClick={() => {
            setEditingStage(r);
            setNewStage(r.stage);
          }}
        >
          Update Stage
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6" data-testid="platform-crm">
      {toast && (
        <Toast message={toast.text} tone={toast.tone} onDismiss={() => setToast(undefined)} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 data-testid="page-title" className="font-display text-3xl font-bold text-heading">
            Platform CRM: Prospective Firms
          </h1>
          <p className="text-sm text-muted">
            Track and nurture prospective accounting firms through the sales pipeline before they
            submit onboarding applications.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus aria-hidden className="size-4" /> Add Prospective Firm
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-control bg-brand-50 p-2 text-brand-700">
              <Building2 className="size-5" />
            </div>
            <div>
              <p className="text-xs text-muted">Total Prospects</p>
              <p className="text-2xl font-bold text-heading">{kpis.total}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-control bg-info-soft p-2 text-action">
              <TrendingUp className="size-5" />
            </div>
            <div>
              <p className="text-xs text-muted">Active Pipeline</p>
              <p className="text-2xl font-bold text-heading">{kpis.active}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-control bg-warning-soft p-2 text-gold">
              <CalendarCheck className="size-5" />
            </div>
            <div>
              <p className="text-xs text-muted">Demos Scheduled</p>
              <p className="text-2xl font-bold text-heading">{kpis.demos}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-control bg-success-soft p-2 text-success">
              <CheckCircle2 className="size-5" />
            </div>
            <div>
              <p className="text-xs text-muted">Converted / Won</p>
              <p className="text-2xl font-bold text-heading">{kpis.won}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filter Bar & Table */}
      <Card>
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <Input
            label="Search prospects"
            type="search"
            placeholder="Search by firm name, contact, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            label="Filter by stage"
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            options={[
              { value: '', label: 'All Stages' },
              ...Object.entries(STAGE_LABELS).map(([val, info]) => ({
                value: val,
                label: info.label,
              })),
            ]}
          />
        </div>

        <Table
          caption="Prospective accounting firms"
          rows={filtered}
          columns={columns}
          rowKey={(r) => r.id}
          pageSize={10}
          emptyTitle="No prospects match"
          emptyText="No prospective firms found matching the current search filters."
        />
      </Card>

      {/* Add Lead Modal */}
      <Modal
        open={adding}
        title="Add Prospective Accounting Firm"
        onClose={() => setAdding(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd}>Save Prospect</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Firm Name *"
            placeholder="e.g. Sterling Tax & Advisory LLC"
            value={firmName}
            onChange={(e) => setFirmName(e.target.value)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Primary Contact Person *"
              placeholder="e.g. Sarah Jenkins, CPA"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
            <Input
              label="Contact Email *"
              type="email"
              placeholder="sarah@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Contact Phone"
              type="tel"
              placeholder="(555) 000-0000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Select
              label="Target Subscription Plan"
              value={targetTier}
              onChange={(e) => setTargetTier(e.target.value as ProspectiveFirmLead['targetTier'])}
              options={[
                { value: 'SOLO', label: 'Solo Core / Pro' },
                { value: 'TEAM_PRO', label: 'Team Pro' },
                { value: 'BUSINESS', label: 'Business Suite' },
                { value: 'ENTERPRISE', label: 'Enterprise' },
              ]}
            />
          </div>
          <Input
            label="Estimated Staff Count"
            type="number"
            min={1}
            value={String(staffCount)}
            onChange={(e) => setStaffCount(Number(e.target.value) || 1)}
          />
          <Input
            label="Initial Sales Notes"
            placeholder="Notes on current software, needs, timeline…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </Modal>

      {/* Update Stage Modal */}
      <Modal
        open={!!editingStage}
        title="Update Pipeline Stage"
        subtitle={editingStage?.firmName}
        onClose={() => setEditingStage(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditingStage(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateStage}>Save Stage</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Select
            label="Pipeline Stage"
            value={newStage}
            onChange={(e) => setNewStage(e.target.value as ProspectiveFirmStage)}
            options={Object.entries(STAGE_LABELS).map(([val, info]) => ({
              value: val,
              label: info.label,
            }))}
          />
          <p className="text-xs text-muted">
            Updating the stage moves this prospective firm forward in the sales pipeline and updates
            their last contact date.
          </p>
        </div>
      </Modal>
    </div>
  );
}
