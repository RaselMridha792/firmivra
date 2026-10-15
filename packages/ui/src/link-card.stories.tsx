import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Buildings,
  ChartBar,
  Database,
  FileText,
  GearSix,
  LockSimple,
  PaintBrush,
  ShieldCheck,
  TreeStructure,
  UploadSimple,
  UserPlus,
  UsersThree,
} from '@phosphor-icons/react';
import { LinkCard } from './index';

const meta = {
  title: 'Firm Backend/LinkCard',
  component: LinkCard,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof LinkCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Staff Management's tiles: arrow button on the right. */
export const Default: Story = {
  args: { icon: UserPlus, title: 'Create Staff Account' },
  render: () => (
    <div className="grid max-w-7xl grid-cols-3 gap-4">
      <LinkCard
        icon={UserPlus}
        title="Create Staff Account"
        description="Add a new team member and set their role, permissions, and access."
        href="#"
      />
      <LinkCard
        icon={UsersThree}
        title="Manage Staff Accounts"
        description="View, edit, or deactivate staff accounts."
        href="#"
      />
      <LinkCard
        icon={ShieldCheck}
        title="Roles & Permissions"
        description="Create and manage roles. Set what each staff member can see and do."
        href="#"
      />
      <LinkCard
        icon={TreeStructure}
        title="Teams & Departments"
        description="Organize staff into teams or departments."
        href="#"
      />
      <LinkCard
        icon={LockSimple}
        title="Account Access & Security"
        description="Reset passwords, manage MFA, and control sign-in access."
        href="#"
      />
      <LinkCard
        icon={FileText}
        title="Activity & Login History"
        description="View staff activity, login history, and security logs."
        href="#"
      />
      <LinkCard
        icon={UploadSimple}
        title="Bulk Upload Staff"
        description="Add or update multiple staff accounts using a template file."
        href="#"
      />
      <LinkCard
        icon={GearSix}
        title="Staff Settings"
        description="Configure staff-related preferences and default access."
        href="#"
      />
      <LinkCard
        icon={ChartBar}
        title="Reports"
        description="View staff performance, activity, and access reports."
        href="#"
      />
    </div>
  ),
};

/** Settings' Quick Settings: tinted cards with a text link. */
export const QuickSettings: Story = {
  args: { icon: Buildings, title: 'Company Management' },
  render: () => (
    <div className="grid max-w-5xl grid-cols-3 gap-4">
      <LinkCard
        icon={Buildings}
        tone="green"
        surface="blue"
        title="Company Management"
        description="Approve, suspend, or manage company accounts."
        actionLabel="Manage Companies"
        href="#"
      />
      <LinkCard
        icon={PaintBrush}
        tone="amber"
        iconTone="navy"
        surface="amber"
        title="Branding & White Label"
        description="Logo, dashboard colors, email identity, and portal branding."
        actionLabel="Customize Branding"
        href="#"
      />
      <LinkCard
        icon={Database}
        tone="navy"
        surface="amber"
        title="System & Data"
        description="Default preferences, backups, imports, exports, and audit history."
        actionLabel="System Settings"
        href="#"
      />
    </div>
  ),
};

/** No description: the title alone. */
export const Empty: Story = {
  args: { icon: GearSix, title: 'Staff Settings', href: '#' },
  render: (args) => (
    <div className="max-w-md">
      <LinkCard {...args} />
    </div>
  ),
};

export const LongText: Story = {
  args: {
    icon: UsersThree,
    title: 'Manage staff accounts, departments, teams and every access rule across all offices',
    description:
      'View, edit, deactivate or reactivate staff accounts, move people between teams, and review who can see client records, payroll and billing in every branch of the firm.',
    href: '#',
  },
  render: (args) => (
    <div className="max-w-md">
      <LinkCard {...args} />
    </div>
  ),
};
