import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import {
  Button,
  EmptyState,
  Modal,
  Skeleton,
  Stepper,
  Table,
  Tabs,
  Toast,
  type TableSort,
} from './index';

const meta = { title: 'Design System/Advanced', parameters: { layout: 'padded' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const tableRows = [10, 2, 3].map((sum) => ({ id: String(sum), sum }));
const setupSteps = ['Branding', 'Business details', 'Finish setup'].map((label) => ({
  id: label,
  label,
}));
export const DataTable: Story = {
  render: () => (
    <Table
      caption="Invoice totals"
      pageSize={1}
      rows={tableRows}
      rowKey={(row) => row.id}
      columns={[{ id: 'sum', label: 'Total', cell: (r) => r.sum, sortValue: (r) => r.sum }]}
    />
  ),
};
function ServerTableDemo() {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<TableSort>();
  // A synthetic API response: Table must retain its order and all returned rows.
  const rows = page === 1 ? tableRows : [{ id: '20', sum: 20 }];
  return (
    <Table
      caption="API invoices"
      rows={rows}
      pageSize={1}
      rowKey={(r) => r.id}
      columns={[{ id: 'sum', label: 'Total', cell: (r) => r.sum, sortable: true }]}
      server={{
        page,
        sort,
        hasNext: page === 1,
        hasPrevious: page > 1,
        onNext: () => setPage(2),
        onPrevious: () => setPage(1),
        onSort: (next) => {
          setSort(next);
          setPage(1);
        },
      }}
    />
  );
}
export const ApiPage: Story = { render: () => <ServerTableDemo /> };
export const ApiPageRegression: Story = {
  render: () => <ServerTableDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByRole('table', { name: 'API invoices' });
    const values = () => [...table.querySelectorAll('tbody tr')].map((row) => row.textContent);
    await expect(values()).toEqual(['10', '2', '3']);
    await userEvent.click(canvas.getByRole('button', { name: 'Total' }));
    await expect(canvas.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending');
    await expect(values()).toEqual(['10', '2', '3']);
    await userEvent.click(canvas.getByRole('button', { name: 'Next' }));
    await expect(values()).toEqual(['20']);
    await expect(canvas.getByRole('button', { name: 'Next' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Previous' }));
    await expect(values()).toEqual(['10', '2', '3']);
  },
};
export const EmptyTable: Story = {
  render: () => (
    <Table
      caption="Invoices"
      rows={tableRows.slice(0, 0)}
      columns={[]}
      rowKey={(r) => r.id}
      emptyTitle="No invoices"
      emptyText="Create an invoice to get started."
    />
  ),
};
export const ErrorToast: Story = {
  render: () => <Toast tone="error" message="Could not save changes" onDismiss={() => {}} />,
};
function DialogDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Modal title="Review changes" open={open} onClose={() => setOpen(false)}>
        Review before saving.
      </Modal>
    </>
  );
}
export const Dialog: Story = { render: () => <DialogDemo /> };
function TabDemo() {
  const [value, setValue] = useState('documents');
  return (
    <Tabs
      label="Client record"
      value={value}
      onChange={setValue}
      items={[
        { id: 'documents', label: 'Documents', content: 'Client documents' },
        { id: 'messages', label: 'Messages', content: 'Client messages' },
      ]}
    />
  );
}
export const RecordTabs: Story = { render: () => <TabDemo /> };
function ToastDemo() {
  const [visible, setVisible] = useState(true);
  return visible ? (
    <Toast message="Changes saved" onDismiss={() => setVisible(false)} />
  ) : (
    <Button onClick={() => setVisible(true)}>Show notification</Button>
  );
}
export const NotificationToast: Story = { render: () => <ToastDemo /> };
export const Loading: Story = { render: () => <Skeleton /> };
export const EmptyRecords: Story = {
  render: () => (
    <EmptyState title="No documents yet" description="Shared documents will appear here." />
  ),
};
export const SetupSteps: Story = {
  render: () => <Stepper current="Business details" steps={setupSteps} />,
};
