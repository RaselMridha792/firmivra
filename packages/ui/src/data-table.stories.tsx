import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge, Button, Pagination, Table, type Column } from './index';

const meta = { title: 'Design System/Data table', parameters: { layout: 'padded' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

interface Row {
  id: string;
  name: string;
  status: 'Active' | 'Pending';
  balance: number;
}
const rows: Row[] = Array.from({ length: 24 }, (_, i) => ({
  id: String(i + 1),
  name: `Sample Client ${i + 1}`,
  status: i % 4 ? 'Active' : 'Pending',
  balance: i % 5 ? 0 : 150 * (i + 1),
}));
const columns: Column<Row>[] = [
  { id: 'name', label: 'Name', sortValue: (r) => r.name, cell: (r) => <b>{r.name}</b> },
  {
    id: 'status',
    label: 'Status',
    cell: (r) => <Badge tone={r.status === 'Active' ? 'success' : 'warning'}>{r.status}</Badge>,
  },
  {
    id: 'balance',
    label: 'Balance Due',
    sortValue: (r) => r.balance,
    cell: (r) => <span className={r.balance ? 'text-danger' : ''}>${r.balance.toFixed(2)}</span>,
  },
];
const actions = (r: Row) => (
  <Button variant="secondary" aria-label={`Open ${r.name}`}>
    Open
  </Button>
);
const base = { caption: 'Clients', columns, rowKey: (r: Row) => r.id, noun: 'clients' };

function Selectable() {
  const [selected, setSelected] = useState(['1', '2']);
  return (
    <Table
      {...base}
      rows={rows}
      dense
      pageSize={8}
      pageSizes={[8, 16, 24]}
      selection={{ selected, onChange: setSelected }}
      rowActions={actions}
    />
  );
}
export const SelectableRows: Story = { render: () => <Selectable /> };
export const Loading: Story = {
  render: () => <Table {...base} loading rows={[]} rowActions={actions} />,
};
export const Empty: Story = {
  render: () => (
    <Table
      {...base}
      rows={[]}
      emptyTitle="No clients yet"
      emptyText="Add your first client to get started."
      emptyAction={<Button>Add New Client</Button>}
    />
  ),
};
function Pager() {
  const [page, setPage] = useState(1);
  return <Pagination page={page} pageCount={16} onPage={setPage} summary="Showing 127 clients" />;
}
export const Pages: Story = { render: () => <Pager /> };
export const CursorPages: Story = {
  render: () => <Pagination page={2} hasNext onPage={() => {}} />,
};
