import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Button,
  Card,
  Input,
  Select,
  Checkbox,
  Textarea,
  Badge,
  Alert,
  Toast,
  EmptyState,
  Skeleton,
  Modal,
  Tabs,
  Table,
  Sidebar,
  Header,
  tokens,
  themes,
  type ThemeName,
  type Tone,
} from './index';

const meta = {
  title: 'Design System/Foundation',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function ComponentsDemo() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('documents');
  const [toast, setToast] = useState(true);
  return (
    <div className="space-y-6 bg-canvas p-6 text-text">
      <Header title="LVP Accounting & Taxes" user="Alex" />
      <h1 className="text-3xl font-bold text-heading">Core components</h1>
      <Card title="Buttons">
        <div className="flex flex-wrap gap-3">
          {(['primary', 'secondary', 'outline', 'danger', 'link', 'ghost', 'public'] as const).map(
            (variant) => (
              <Button key={variant} variant={variant}>
                {variant}
              </Button>
            ),
          )}
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
        </div>
      </Card>
      <Card title="Fields">
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Name" placeholder="Full name" />
          <Input label="Email with error" type="email" error="Enter a valid email" />
          <Input label="Disabled field" value="Read only" disabled />
          <Select
            label="Service"
            options={[
              { value: 'tax', label: 'Tax preparation' },
              { value: 'books', label: 'Bookkeeping' },
            ]}
          />
          <Checkbox label="Send an email notification" />
          <Textarea label="Notes" maxLength={1000} />
        </div>
      </Card>
      <Card title="Statuses">
        <div className="flex flex-wrap gap-3">
          {(['info', 'success', 'warning', 'danger', 'neutral'] as Tone[]).map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
        </div>
        <div className="mt-4 space-y-4">
          <Alert title="Action required" tone="warning">
            Review this item before its due date.
          </Alert>
          <Alert title="Cannot upload documents" tone="danger">
            An open service is required.
          </Alert>
        </div>
      </Card>
      <Card title="Folder tabs">
        <Tabs
          label="Document categories"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'documents', label: 'My Documents', content: 'Your document list' },
            { id: 'invoices', label: 'Invoices', content: 'Your invoice list' },
          ]}
        />
      </Card>
      <Card title="Sortable and paginated table">
        <Table
          rows={[
            { id: '1', name: 'Zoe', amount: 300 },
            { id: '2', name: 'Alex', amount: 20 },
            { id: '3', name: 'Sam', amount: 100 },
          ]}
          rowKey={(r) => r.id}
          caption="Demo invoices"
          pageSize={2}
          columns={[
            { id: 'name', label: 'Name', cell: (r) => r.name, sortValue: (r) => r.name },
            {
              id: 'amount',
              label: 'Amount',
              cell: (r) => `$${r.amount}`,
              sortValue: (r) => r.amount,
            },
          ]}
        />
      </Card>
      <Card title="Modal">
        <Button onClick={() => setOpen(true)}>Open dialog</Button>
        <Modal title="Request a document" open={open} onClose={() => setOpen(false)}>
          <Input label="Document name" />
          <div className="mt-4">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </Modal>
      </Card>
      {toast ? (
        <Toast message="Changes saved" onDismiss={() => setToast(false)} />
      ) : (
        <Button onClick={() => setToast(true)}>Show toast</Button>
      )}
      <EmptyState title="No documents yet" description="Your documents will appear here." />
      <div role="status" aria-label="Loading content" className="space-y-3">
        <Skeleton />
        <Skeleton className="h-11" />
      </div>
      <div className="h-96 overflow-auto">
        <Sidebar
          active="/"
          items={[
            { href: '/', label: 'Dashboard' },
            { href: '/clients', label: 'Clients' },
          ]}
        />
      </div>
    </div>
  );
}

function TokenGallery() {
  const [theme, setTheme] = useState<ThemeName>('firmivra');
  const swatches = {
    ...Object.fromEntries(
      Object.entries(tokens.palettes.firmivra).map(([k, v]) => [`firmivra.${k}`, v]),
    ),
    ...Object.fromEntries(Object.entries(tokens.palettes.lvp).map(([k, v]) => [`lvp.${k}`, v])),
    ...Object.fromEntries(Object.entries(tokens.neutral).map(([k, v]) => [`neutral.${k}`, v])),
    ...Object.fromEntries(Object.entries(tokens.folder).map(([k, v]) => [`folder.${k}`, v])),
    ...Object.fromEntries(Object.entries(tokens.status).map(([k, v]) => [`status.${k}`, v])),
    ...Object.fromEntries(Object.entries(tokens.business).map(([k, v]) => [`business.${k}`, v])),
  };
  return (
    <div data-theme={theme} className="space-y-8 bg-canvas p-6 font-sans text-text">
      <h1 className="text-3xl font-bold text-heading">Design tokens</h1>
      <Select
        label="Theme"
        value={theme}
        onChange={(e) => setTheme(e.target.value as ThemeName)}
        options={Object.keys(themes).map((value) => ({ value, label: value }))}
      />
      <Card title="Same components, different brand">
        <div className="flex flex-wrap gap-3">
          <Button>Portal action</Button>
          <Button variant="public">Public action</Button>
          <Badge tone="success">Paid</Badge>
          <Badge tone="warning">Awaiting review</Badge>
        </div>
      </Card>
      <h2 className="text-2xl font-bold">Colour palettes</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(swatches).map(([name, value]) => (
          <Card key={name}>
            <div
              className="mb-3 h-12 rounded-control border border-control-border"
              style={{ backgroundColor: value }}
            />
            <p className="text-sm font-semibold">{name}</p>
            <p className="text-sm text-muted">{value}</p>
          </Card>
        ))}
      </div>
      <Card title="Type scale">
        <p style={{ fontFamily: tokens.typography.display }}>Display: Georgia / Times New Roman</p>
        {Object.entries(tokens.typography.size).map(([name, value]) => (
          <p key={name} style={{ fontSize: value }} className="py-2">
            {name} · {value} · Your business, in one place.
          </p>
        ))}
        <p>
          Weights: {Object.values(tokens.typography.weight).join(', ')}. Eyebrow tracking:{' '}
          {tokens.typography.eyebrowTracking}.
        </p>
      </Card>
      <Card title="Spacing">
        {Object.entries(tokens.spacing).map(([name, value]) => (
          <div key={name} className="flex items-center gap-4 py-2">
            <span className="w-32 text-sm">
              {name}: {value}
            </span>
            <span className="block h-4 bg-action" style={{ width: value }} />
          </div>
        ))}
      </Card>
      <Card title="Radius">
        <div className="flex flex-wrap gap-6">
          {Object.entries(tokens.radius).map(([name, value]) => (
            <div
              key={name}
              className="border border-control-border bg-folder-surface p-6"
              style={{ borderRadius: value }}
            >
              {name}: {value}
            </div>
          ))}
        </div>
      </Card>
      <Card title="Shadows">
        <div className="flex flex-wrap gap-6">
          {Object.entries(tokens.shadow).map(([name, value]) => (
            <div key={name} className="rounded-card bg-surface p-6" style={{ boxShadow: value }}>
              {name}
              <p className="text-xs">{value}</p>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Breakpoints and layout">
        <p>
          {Object.entries(tokens.breakpoint)
            .map(([name, value]) => `${name}: ${value}`)
            .join(' · ')}
        </p>
        <p className="mt-4">
          {Object.entries(tokens.layout)
            .map(([name, value]) => `${name}: ${value}`)
            .join(' · ')}
        </p>
        <p className="mt-4">Scrim: {tokens.overlay}. Focus: 2px outline with 2px offset.</p>
      </Card>
    </div>
  );
}

export const Components: Story = { render: () => <ComponentsDemo /> };
export const Tokens: Story = { render: () => <TokenGallery /> };
export const Loading: Story = {
  render: () => <Table rows={[]} columns={[]} rowKey={() => ''} caption="Documents" loading />,
};
export const Empty: Story = {
  render: () => (
    <EmptyState title="No records" description="Add your first record to get started." />
  ),
};
export const Error: Story = {
  render: () => (
    <Alert title="Unable to load records" tone="danger">
      Try again in a moment.
    </Alert>
  ),
};
export const NoPermission: Story = {
  render: () => (
    <EmptyState title="Permission required" description="Ask your firm owner for access." />
  ),
};
