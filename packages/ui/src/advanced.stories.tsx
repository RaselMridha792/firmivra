import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, EmptyState, Modal, Skeleton, Stepper, Table, Tabs, Toast } from './index';

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
