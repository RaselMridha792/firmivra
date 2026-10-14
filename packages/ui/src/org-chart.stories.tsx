import type { Meta, StoryObj } from '@storybook/react-vite';
import { OrgChart } from './index';

const meta = {
  title: 'Firm Backend/OrgChart',
  component: OrgChart,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof OrgChart>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Teams & Departments' Org Chart tab. */
export const Default: Story = {
  args: {
    people: [
      { id: 'owner', name: 'Morgan Avery', title: 'Owner / CEO' },
      {
        id: 'tax',
        name: 'Lena Fischer',
        title: 'Tax Manager',
        parentId: 'owner',
        note: 'Head of Tax',
      },
      {
        id: 'books',
        name: 'Marcus Bell',
        title: 'Bookkeeping Manager',
        parentId: 'owner',
        note: 'Head of Bookkeeping',
      },
      { id: 'ops', name: 'Priya Ramos', title: 'Operations Manager', parentId: 'owner' },
      { id: 't1', name: 'Daniel Okafor', title: 'Tax Preparer', parentId: 'tax' },
      { id: 't2', name: 'Iris Novak', title: 'Intern', parentId: 'tax' },
      { id: 'b1', name: 'Hana Kim', title: 'Payroll & Accounting Specialist', parentId: 'books' },
    ],
  },
};

export const Empty: Story = { args: { people: [] } };

export const LongText: Story = {
  args: {
    people: [
      {
        id: 'a',
        name: 'Alexandria Montgomery-Whitfield',
        title: 'Chief Operating Officer and Head of Client Services',
      },
      {
        id: 'b',
        name: 'Bartholomew Okonkwo-Lindqvist',
        title: 'Senior Tax Planning Advisor',
        parentId: 'a',
      },
    ],
  },
};
