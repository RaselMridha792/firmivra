'use client';

import { Badge, Button, Card, Input, Modal, Table, Toast, type Column } from '@firmivra/ui';
import { Building2, Edit2, Layers, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

export interface PlanTierItem {
  id: string;
  name: string;
  code: string;
  monthlyPrice: number;
  annualPrice: number;
  clientQuota: number;
  staffSeats: number;
  storageGb: number;
  modules: string[];
  enrolledFirms: number;
  status: 'ACTIVE' | 'ARCHIVED';
}

const INITIAL_PLANS: PlanTierItem[] = [
  {
    id: 'plan-1',
    name: 'Solo Core',
    code: 'SOLO_CORE',
    monthlyPrice: 99,
    annualPrice: 990,
    clientQuota: 100,
    staffSeats: 1,
    storageGb: 25,
    modules: ['Appointments', 'Invoices', 'Documents', 'Client Portal'],
    enrolledFirms: 14,
    status: 'ACTIVE',
  },
  {
    id: 'plan-2',
    name: 'Solo Pro',
    code: 'SOLO_PRO',
    monthlyPrice: 199,
    annualPrice: 1990,
    clientQuota: 250,
    staffSeats: 2,
    storageGb: 50,
    modules: ['Appointments', 'Invoices', 'Documents', 'Firm Sign', 'Tax Returns', 'Client Portal'],
    enrolledFirms: 38,
    status: 'ACTIVE',
  },
  {
    id: 'plan-3',
    name: 'Solo Elite',
    code: 'SOLO_ELITE',
    monthlyPrice: 299,
    annualPrice: 2990,
    clientQuota: 500,
    staffSeats: 3,
    storageGb: 100,
    modules: [
      'Appointments',
      'Invoices',
      'Documents',
      'Firm Sign',
      'Tax Returns',
      'Tax Planning',
      'Client Portal',
    ],
    enrolledFirms: 22,
    status: 'ACTIVE',
  },
  {
    id: 'plan-4',
    name: 'Team Pro',
    code: 'TEAM_PRO',
    monthlyPrice: 499,
    annualPrice: 4990,
    clientQuota: 1000,
    staffSeats: 10,
    storageGb: 250,
    modules: ['All Modules', 'Bookkeeping', 'Payroll', 'Firm Sign', 'Tax Planning', 'Advisory'],
    enrolledFirms: 45,
    status: 'ACTIVE',
  },
  {
    id: 'plan-5',
    name: 'Business Suite',
    code: 'BUSINESS',
    monthlyPrice: 799,
    annualPrice: 7990,
    clientQuota: 2500,
    staffSeats: 25,
    storageGb: 500,
    modules: ['All Modules', 'Automations', 'Advanced Reports', 'Multi-Office', 'Custom Branding'],
    enrolledFirms: 19,
    status: 'ACTIVE',
  },
  {
    id: 'plan-6',
    name: 'Enterprise',
    code: 'ENTERPRISE',
    monthlyPrice: 1299,
    annualPrice: 12990,
    clientQuota: 10000,
    staffSeats: 100,
    storageGb: 2000,
    modules: [
      'All Modules',
      'Dedicated Support',
      'Custom Integrations',
      'SLA Guarantee',
      'Unlimited E-Sign',
    ],
    enrolledFirms: 6,
    status: 'ACTIVE',
  },
];

export function PlansManagement() {
  const [plans, setPlans] = useState<PlanTierItem[]>(INITIAL_PLANS);
  const [editingPlan, setEditingPlan] = useState<PlanTierItem | null>(null);
  const [monthly, setMonthly] = useState('');
  const [annual, setAnnual] = useState('');
  const [clients, setClients] = useState('');
  const [staff, setStaff] = useState('');
  const [storage, setStorage] = useState('');
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error' }>();

  function openEdit(p: PlanTierItem) {
    setEditingPlan(p);
    setMonthly(String(p.monthlyPrice));
    setAnnual(String(p.annualPrice));
    setClients(String(p.clientQuota));
    setStaff(String(p.staffSeats));
    setStorage(String(p.storageGb));
  }

  function handleSave() {
    if (!editingPlan) return;
    const m = Number(monthly) || editingPlan.monthlyPrice;
    const a = Number(annual) || editingPlan.annualPrice;
    const c = Number(clients) || editingPlan.clientQuota;
    const s = Number(staff) || editingPlan.staffSeats;
    const st = Number(storage) || editingPlan.storageGb;

    setPlans((prev) =>
      prev.map((item) =>
        item.id === editingPlan.id
          ? {
              ...item,
              monthlyPrice: m,
              annualPrice: a,
              clientQuota: c,
              staffSeats: s,
              storageGb: st,
            }
          : item,
      ),
    );

    setToast({ text: `Updated ${editingPlan.name} pricing and limits`, tone: 'success' });
    setEditingPlan(null);
  }

  const columns: Column<PlanTierItem>[] = [
    {
      id: 'plan',
      label: 'Subscription Plan',
      cell: (r) => (
        <div className="flex flex-col">
          <span className="font-semibold text-heading">{r.name}</span>
          <span className="font-mono text-xs text-muted">{r.code}</span>
        </div>
      ),
    },
    {
      id: 'pricing',
      label: 'Price (Monthly / Annual)',
      cell: (r) => (
        <div className="flex flex-col text-xs font-medium text-heading">
          <span>{`$${r.monthlyPrice} / mo`}</span>
          <span className="text-muted">{`$${r.annualPrice} / yr`}</span>
        </div>
      ),
    },
    {
      id: 'limits',
      label: 'Quotas & Quotas',
      cell: (r) => (
        <div className="flex flex-col text-xs text-muted">
          <span>{r.clientQuota.toLocaleString()} clients</span>
          <span>{r.staffSeats} staff seats</span>
          <span>{r.storageGb} GB storage</span>
        </div>
      ),
    },
    {
      id: 'modules',
      label: 'Key Modules Included',
      cell: (r) => <span className="text-xs text-text">{r.modules.slice(0, 3).join(', ')}...</span>,
    },
    {
      id: 'firms',
      label: 'Enrolled Firms',
      cell: (r) => (
        <Badge tone="info">
          {r.enrolledFirms} {r.enrolledFirms === 1 ? 'firm' : 'firms'}
        </Badge>
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      cell: (r) => (
        <Button variant="secondary" className="text-xs" onClick={() => openEdit(r)}>
          <Edit2 className="size-3.5" /> Edit Tier
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6" data-testid="plans-management">
      {toast && (
        <Toast message={toast.text} tone={toast.tone} onDismiss={() => setToast(undefined)} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 data-testid="page-title" className="font-display text-3xl font-bold text-heading">
            Plan Tiers & Subscriptions
          </h1>
          <p className="text-sm text-muted">
            Manage platform subscription packages, pricing tiers, and client/staff entitlements
            across tenant firms.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/subscriptions">
            <Button variant="secondary">View Firm Subscriptions</Button>
          </Link>
          <Link href="/billing">
            <Button variant="secondary">Billing & Revenue</Button>
          </Link>
        </div>
      </div>

      {/* Summary KPI Stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-control bg-brand-50 p-2 text-brand-700">
              <Layers className="size-5" />
            </div>
            <div>
              <p className="text-xs text-muted">Active Tiers</p>
              <p className="text-2xl font-bold text-heading">{plans.length}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-control bg-info-soft p-2 text-action">
              <Building2 className="size-5" />
            </div>
            <div>
              <p className="text-xs text-muted">Total Subscribed Firms</p>
              <p className="text-2xl font-bold text-heading">
                {plans.reduce((acc, p) => acc + p.enrolledFirms, 0)}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-control bg-success-soft p-2 text-success">
              <Sparkles className="size-5" />
            </div>
            <div>
              <p className="text-xs text-muted">Top Tier</p>
              <p className="text-lg font-bold text-heading">Team Pro (45 firms)</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Tiers Table */}
      <Card title="Subscription Plan Packages">
        <p className="mb-4 text-xs text-muted">
          Synchronized with the platform <code>PlatformPlan</code> and{' '}
          <code>PlatformFirmSubscription</code> data models. Changes update the catalog used when
          onboarding new tenant firms.
        </p>
        <Table
          caption="Subscription plan tiers"
          rows={plans}
          columns={columns}
          rowKey={(r) => r.id}
          pageSize={10}
        />
      </Card>

      {/* Edit Tier Modal */}
      <Modal
        open={!!editingPlan}
        title={`Edit Plan Tier: ${editingPlan?.name}`}
        onClose={() => setEditingPlan(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditingPlan(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save Changes</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Monthly Price ($ USD) *"
              type="number"
              min={0}
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
            />
            <Input
              label="Annual Price ($ USD) *"
              type="number"
              min={0}
              value={annual}
              onChange={(e) => setAnnual(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="Max Clients *"
              type="number"
              min={1}
              value={clients}
              onChange={(e) => setClients(e.target.value)}
            />
            <Input
              label="Staff Seats *"
              type="number"
              min={1}
              value={staff}
              onChange={(e) => setStaff(e.target.value)}
            />
            <Input
              label="Storage (GB) *"
              type="number"
              min={1}
              value={storage}
              onChange={(e) => setStorage(e.target.value)}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
