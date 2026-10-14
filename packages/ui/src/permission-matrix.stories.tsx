import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  CalendarCheck,
  FileText,
  House,
  ListBullets,
  PlusCircle,
  UsersThree,
} from '@phosphor-icons/react';
import { PermissionMatrix, type PermissionMatrixProps, type PermissionValue } from './index';

const meta = {
  title: 'Firm Backend/PermissionMatrix',
  component: PermissionMatrix,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof PermissionMatrix>;
export default meta;
type Story = StoryObj<typeof meta>;

function Grid(props: Omit<PermissionMatrixProps, 'onChange'>) {
  const [value, setValue] = useState<PermissionValue>(props.value);
  return (
    <div className="max-w-4xl">
      <PermissionMatrix {...props} value={value} onChange={setValue} />
    </div>
  );
}

const requires = {
  create: 'view',
  edit: 'view',
  delete: 'edit',
  approve: 'view',
  manage: 'view',
  export: 'view',
};

/** Create Staff step 2: module icons and Full Access. */
export const Default: Story = {
  args: {
    rowHeader: 'Module / Page',
    fullAccess: true,
    requires,
    rows: [
      { id: 'dashboard', label: 'Dashboard', icon: House, tone: 'blue' },
      { id: 'clients', label: 'Clients', icon: UsersThree, tone: 'blue' },
      { id: 'leads', label: 'Leads / Prospects', icon: PlusCircle, tone: 'red' },
      { id: 'appointments', label: 'Appointments', icon: CalendarCheck, tone: 'purple' },
      { id: 'tasks', label: 'Tasks', icon: ListBullets, tone: 'blue' },
      { id: 'returns', label: 'Tax Returns', icon: FileText, tone: 'navy' },
    ],
    columns: ['View', 'Create', 'Edit', 'Delete', 'Approve', 'Manage'].map((l) => ({
      id: l.toLowerCase(),
      label: l,
    })),
    value: {
      dashboard: ['view'],
      clients: ['view', 'create', 'edit'],
      leads: ['view'],
      appointments: ['view', 'create', 'edit'],
      tasks: ['view'],
      returns: ['view', 'create', 'edit'],
    },
  },
  render: (args) => <Grid {...args} />,
};

/** Settings > Users & Roles: no icons, Export and Admin columns. */
export const UsersAndRoles: Story = {
  args: {
    rowHeader: 'Module',
    rows: ['Clients', 'Leads', 'Appointments', 'Intake Forms', 'Documents'].map((l) => ({
      id: l,
      label: l,
    })),
    columns: ['View', 'Create', 'Edit', 'Approve', 'Export', 'Admin'].map((l) => ({
      id: l.toLowerCase(),
      label: l,
    })),
    value: { Clients: ['view', 'create', 'edit'], Leads: ['view', 'create'] },
  },
  render: (args) => <Grid {...args} />,
};

export const Empty: Story = {
  args: { rows: [], columns: [{ id: 'view', label: 'View' }], value: {} },
};

export const LongText: Story = {
  args: {
    rowHeader: 'Module / Page',
    readOnly: true,
    rows: [
      {
        id: 'adv',
        label: 'Business Advisory & Development, growth plans and client strategy sessions',
        icon: UsersThree,
      },
    ],
    columns: [
      { id: 'view', label: 'View' },
      { id: 'approve', label: 'Approve and publish to the client portal' },
    ],
    value: { adv: ['view'] },
  },
};
