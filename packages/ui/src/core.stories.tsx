import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Modal,
  Select,
  Skeleton,
  Table,
  Tabs,
  Toast,
} from './index';

const meta = {
  title: 'Design System/Core components',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const SelectField: Story = {
  render: () => (
    <Select
      label="Service"
      options={[
        { value: '', label: 'Choose a service' },
        { value: 'books', label: 'Bookkeeping' },
      ]}
    />
  ),
};
export const CheckboxField: Story = { render: () => <Checkbox label="I agree to the Terms" /> };
export const StatusBadge: Story = {
  render: () => (
    <div className="flex gap-3">
      <Badge tone="success">Paid</Badge>
      <Badge tone="warning">Pending</Badge>
      <Badge tone="danger">Overdue</Badge>
    </div>
  ),
};
export const DataTable: Story = {
  render: () => (
    <Table
      caption="Clients"
      rows={[{ id: 'sample', name: 'Example client' }]}
      rowKey={(row) => row.id}
      columns={[
        { id: 'name', label: 'Client', cell: (row) => row.name, sortValue: (row) => row.name },
      ]}
    />
  ),
};
function DialogDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Modal title="Review changes" open={open} onClose={() => setOpen(false)}>
        <p>Review the record before saving.</p>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
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
export const LoadingSkeleton: Story = {
  render: () => (
    <div className="space-y-3" role="status" aria-label="Loading records">
      <Skeleton />
      <Skeleton className="h-24" />
    </div>
  ),
};
export const EmptyRecords: Story = {
  render: () => (
    <EmptyState
      title="No documents yet"
      description="Documents shared with you will appear here."
    />
  ),
};
