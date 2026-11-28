'use client';

import { Button, Card, Input, Modal, Select, Table, Toast, type Column } from '@firmivra/ui';
import { Copy, Globe, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';

export interface EmbedDomainItem {
  id: string;
  origin: string;
  firmName: string;
  firmSlug: string;
  widgets: string[];
  createdAt: string;
  status: 'ACTIVE' | 'PENDING';
}

const INITIAL_DOMAINS: EmbedDomainItem[] = [
  {
    id: 'emb-1',
    origin: 'https://lvpaccounting.com',
    firmName: 'LVP Accounting & Taxes',
    firmSlug: 'lvp',
    widgets: ['Booking', 'Intake'],
    createdAt: '2026-11-20',
    status: 'ACTIVE',
  },
  {
    id: 'emb-2',
    origin: 'https://taxpros-associates.com',
    firmName: 'TaxPros Associates',
    firmSlug: 'taxpros',
    widgets: ['Booking'],
    createdAt: '2026-11-22',
    status: 'ACTIVE',
  },
];

export function WebsiteManagement() {
  const [domains, setDomains] = useState<EmbedDomainItem[]>(INITIAL_DOMAINS);
  const [adding, setAdding] = useState(false);
  const [newOrigin, setNewOrigin] = useState('');
  const [newFirmName, setNewFirmName] = useState('LVP Accounting & Taxes');
  const [newFirmSlug, setNewFirmSlug] = useState('lvp');
  const [originError, setOriginError] = useState<string>();
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error' }>();

  // Embed Snippet Generator state
  const [snippetWidget, setSnippetWidget] = useState<'booking' | 'intake'>('booking');
  const [snippetSlug, setSnippetSlug] = useState('lvp');
  const [snippetId, setSnippetId] = useState('initial-consultation');

  function validateOrigin(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) {
      setOriginError('Enter an origin');
      return false;
    }
    if (!/^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(trimmed)) {
      setOriginError('Origin must be a bare https://host[:port] with no path or wildcard');
      return false;
    }
    setOriginError(undefined);
    return true;
  }

  function handleAdd() {
    if (!validateOrigin(newOrigin)) return;
    const clean = newOrigin.trim().toLowerCase();
    if (domains.some((d) => d.origin.toLowerCase() === clean)) {
      setOriginError('This origin is already authorized');
      return;
    }

    const nextId = `emb-${domains.length + 1}`;
    const today = new Date().toISOString().slice(0, 10);
    const item: EmbedDomainItem = {
      id: nextId,
      origin: clean,
      firmName: newFirmName,
      firmSlug: newFirmSlug,
      widgets: ['Booking', 'Intake'],
      createdAt: today,
      status: 'ACTIVE',
    };

    setDomains((prev) => [item, ...prev]);
    setAdding(false);
    setNewOrigin('');
    setToast({ text: `Authorized embed domain ${clean}`, tone: 'success' });
  }

  function handleRemove(id: string) {
    const item = domains.find((d) => d.id === id);
    setDomains((prev) => prev.filter((d) => d.id !== id));
    setToast({ text: `Revoked domain ${item?.origin ?? ''}`, tone: 'success' });
  }

  const embedUrl =
    snippetWidget === 'booking'
      ? `https://portal.firmivra.com/${snippetSlug}/book/${snippetId}`
      : `https://portal.firmivra.com/${snippetSlug}/begin/${snippetId}`;

  const iframeSnippet = `<iframe\n  src="${embedUrl}"\n  width="100%"\n  height="750"\n  frameborder="0"\n  allow="camera; microphone"\n></iframe>`;

  const columns: Column<EmbedDomainItem>[] = [
    {
      id: 'origin',
      label: 'Authorized Origin',
      cell: (r) => (
        <div className="flex items-center gap-2 font-mono text-sm font-semibold text-heading">
          <Globe aria-hidden className="size-4 text-brand-600" />
          <span>{r.origin}</span>
        </div>
      ),
    },
    {
      id: 'firm',
      label: 'Tenant Firm',
      cell: (r) => <span className="text-sm text-text">{r.firmName}</span>,
    },
    {
      id: 'widgets',
      label: 'Allowed Widgets',
      cell: (r) => (
        <span className="inline-flex gap-1 text-xs text-muted">{r.widgets.join(', ')}</span>
      ),
    },
    {
      id: 'date',
      label: 'Authorized On',
      cell: (r) => <span className="text-xs text-muted">{r.createdAt}</span>,
    },
    {
      id: 'actions',
      label: 'Actions',
      cell: (r) => (
        <Button
          variant="ghost"
          aria-label={`Revoke ${r.origin}`}
          onClick={() => handleRemove(r.id)}
        >
          <Trash2 aria-hidden className="size-4 text-danger" />
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6" data-testid="website-management">
      {toast && (
        <Toast message={toast.text} tone={toast.tone} onDismiss={() => setToast(undefined)} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 data-testid="page-title" className="font-display text-3xl font-bold text-heading">
            Website Management
          </h1>
          <p className="text-sm text-muted">
            Configure external website domains permitted to embed Firmivra booking and intake
            widgets (EMBED_ALLOWED_ORIGINS policy).
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus aria-hidden className="size-4" /> Add Authorized Domain
        </Button>
      </div>

      {/* Embed Origins Registry */}
      <Card title="Authorized Embed Origins">
        <p className="mb-4 text-xs text-muted">
          Modern web browsers enforce Content Security Policy (CSP) <code>frame-ancestors</code>{' '}
          directives. Only domains explicitly listed below are permitted to frame client booking and
          intake portals.
        </p>
        <Table
          caption="Authorized embed domains"
          rows={domains}
          columns={columns}
          rowKey={(r) => r.id}
          pageSize={10}
          emptyTitle="No embed domains configured"
          emptyText="Add an authorized origin to enable external website embedding."
        />
      </Card>

      {/* Snippet Generator */}
      <Card title="Widget Embed Snippet Generator">
        <div className="grid gap-4 md:grid-cols-3">
          <Select
            label="Widget Type"
            value={snippetWidget}
            onChange={(e) => setSnippetWidget(e.target.value as 'booking' | 'intake')}
            options={[
              { value: 'booking', label: 'Client Booking Widget' },
              { value: 'intake', label: 'Client Intake Form' },
            ]}
          />
          <Input
            label="Firm Slug"
            value={snippetSlug}
            onChange={(e) => setSnippetSlug(e.target.value)}
          />
          <Input
            label={snippetWidget === 'booking' ? 'Appointment Type ID' : 'Intake Form Slug'}
            value={snippetId}
            onChange={(e) => setSnippetId(e.target.value)}
          />
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <label className="text-xs font-semibold text-heading">HTML Embed Snippet</label>
          <div className="relative rounded-control border border-border bg-subtle p-3">
            <pre className="overflow-x-auto font-mono text-xs text-text">{iframeSnippet}</pre>
            <Button
              variant="secondary"
              className="absolute right-3 top-3 text-xs"
              onClick={() => {
                void navigator.clipboard?.writeText(iframeSnippet);
                setToast({ text: 'Embed snippet copied to clipboard', tone: 'success' });
              }}
            >
              <Copy aria-hidden className="size-3.5" /> Copy Code
            </Button>
          </div>
        </div>
      </Card>

      {/* CSP & Security Compliance Banner */}
      <div className="flex items-start gap-3 rounded-control border border-border bg-surface p-4 shadow-sm">
        <ShieldCheck aria-hidden className="size-5 shrink-0 text-success" />
        <div className="text-xs text-muted">
          <p className="font-semibold text-heading">Content Security Policy Compliance</p>
          <p className="mt-0.5">
            Embed requests strictly reject plain HTTP, wildcards, credentials, or arbitrary path
            prefixes. Frame ancestors enforcement ensures embedded booking widgets are immune to
            clickjacking attacks.
          </p>
        </div>
      </div>

      {/* Add Domain Modal */}
      <Modal
        open={adding}
        title="Add Authorized Embed Domain"
        onClose={() => setAdding(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd}>Authorize Domain</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Website Origin *"
            placeholder="https://example.com"
            value={newOrigin}
            error={originError}
            onChange={(e) => {
              setNewOrigin(e.target.value);
              validateOrigin(e.target.value);
            }}
          />
          <p className="-mt-2 text-xs text-muted">
            Must be a bare <code>https://hostname[:port]</code> origin without path or trailing
            slash.
          </p>
          <Input
            label="Tenant Firm Name *"
            value={newFirmName}
            onChange={(e) => setNewFirmName(e.target.value)}
          />
          <Input
            label="Firm Slug *"
            value={newFirmSlug}
            onChange={(e) => setNewFirmSlug(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
