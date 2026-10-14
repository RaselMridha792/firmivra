import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CheckCircle, CurrencyDollar, UserPlus, UsersThree, Users } from '@phosphor-icons/react';
import { Avatar, AvatarGroup, Badge, Button, KpiCard, PageHeader, Toggle } from './index';

const meta = { title: 'Design System/Display', parameters: { layout: 'padded' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Badges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Badge tone="success" dot>
        Active
      </Badge>
      <Badge tone="warning" dot>
        Pending Docs
      </Badge>
      <Badge tone="info" dot>
        New Client
      </Badge>
      <Badge tone="danger" icon={CheckCircle}>
        Rejected
      </Badge>
      <Badge tone="purple">Business</Badge>
      <Badge>Individual</Badge>
    </div>
  ),
};
const people = ['Avery Stone', 'Blake Reed', 'Casey Moon', 'Drew Park'].map((name) => ({
  name,
}));
export const Avatars: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      {(['sm', 'md', 'lg', 'xl'] as const).map((size) => (
        <Avatar key={size} name="Sample One" size={size} />
      ))}
      <AvatarGroup people={people} />
    </div>
  ),
};
function Switches() {
  const [on, setOn] = useState(true);
  return (
    <div className="flex gap-4">
      <Toggle label="Notify client" checked={on} onChange={setOn} />
      <Toggle label="Off" checked={false} onChange={() => {}} />
      <Toggle label="Disabled" checked disabled onChange={() => {}} />
    </div>
  );
}
export const Toggles: Story = { render: () => <Switches /> };
export const KpiRow: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard
        icon={UsersThree}
        tone="blue"
        value="127"
        label="Total Clients"
        trend={{ text: '12%', direction: 'up', good: true }}
        note="vs last month"
      />
      <KpiCard
        icon={UserPlus}
        tone="purple"
        value="24"
        label="New Clients"
        trend={{ text: '5%', direction: 'down', good: false }}
        note="vs last month"
      />
      <KpiCard
        icon={Users}
        tone="grey"
        value="9"
        label="Inactive Clients"
        trend={{ text: 'No change', direction: 'flat' }}
        note="vs last month"
      />
      <KpiCard icon={CurrencyDollar} tone="red" value="" label="Balances Due" loading />
    </div>
  ),
};
export const Header: Story = {
  render: () => (
    <PageHeader
      icon={UsersThree}
      title="Staff Management"
      subtitle="Manage your team, permissions, and access all in one place."
      actions={
        <>
          <Button variant="outline">Import</Button>
          <Button>Add Staff</Button>
        </>
      }
    />
  ),
};
