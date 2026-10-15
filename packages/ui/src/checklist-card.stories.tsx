import type { Meta, StoryObj } from '@storybook/react-vite';
import { PaperPlaneTilt, ShieldCheck } from '@phosphor-icons/react';
import { ChecklistCard, DonutChart } from './index';

const meta = {
  title: 'Firm Backend/ChecklistCard',
  component: ChecklistCard,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ChecklistCard>;
export default meta;
type Story = StoryObj<typeof meta>;

const viewAll = (
  <a href="#" className="text-sm font-semibold text-link underline">
    View All
  </a>
);

/** Settings Checklist (Intake Form Settings). */
export const Default: Story = {
  args: {
    title: 'Settings Checklist',
    action: viewAll,
    items: [
      { id: '1', label: 'General settings configured', done: true },
      { id: '2', label: 'Client experience customized', done: true },
      { id: '3', label: 'Email notifications enabled', done: true },
      { id: '4', label: 'Automation rules set', done: false },
      { id: '5', label: 'Security settings configured', done: true },
    ],
  },
  render: (args) => (
    <div className="max-w-sm">
      <ChecklistCard {...args} />
    </div>
  ),
};

/** Security Best Practices, What Happens Next? and Submission Summary. */
export const Variants: Story = {
  args: { title: 'Security Best Practices', items: [] },
  render: () => (
    <div className="flex max-w-md flex-col gap-4">
      <ChecklistCard
        title="Security Best Practices"
        icon={ShieldCheck}
        iconTone="green"
        surface="success"
        marker="checkbox"
        items={[
          { id: '1', label: 'Use strong, unique passwords.' },
          { id: '2', label: 'Require two-factor authentication.' },
          { id: '3', label: 'Limit access to only what’s needed.' },
          { id: '4', label: 'Review staff access regularly.' },
        ]}
      />
      <ChecklistCard
        title="What Happens Next?"
        icon={PaperPlaneTilt}
        iconTone="blue"
        marker="number"
        items={[
          { id: '1', label: 'The account will be created with the selected role and permissions.' },
          { id: '2', label: 'A welcome email will be sent with login instructions.' },
          { id: '3', label: 'The team member will set their password and complete 2FA.' },
        ]}
      />
      <ChecklistCard
        title="Submission Summary"
        action={viewAll}
        aside={
          <DonutChart
            segments={[{ label: 'Completed', value: 100, tone: 'green' }]}
            total={100}
            centerValue="100%"
            centerLabel="Completed"
            legend={false}
            size="sm"
          />
        }
        items={[
          { id: '1', label: 'All questions answered', done: true },
          { id: '2', label: 'Required documents uploaded', done: true },
          { id: '3', label: 'Form submitted', done: true },
          { id: '4', label: 'Ready for review', done: true },
        ]}
      />
    </div>
  ),
};

export const Empty: Story = {
  args: { title: 'Settings Checklist', items: [], emptyText: 'No checks to show yet.' },
  render: (args) => (
    <div className="max-w-sm">
      <ChecklistCard {...args} />
    </div>
  ),
};

export const LongText: Story = {
  args: {
    title: 'Security best practices for every staff member who can see client tax records',
    icon: ShieldCheck,
    marker: 'checkbox',
    surface: 'success',
    items: [
      {
        id: '1',
        label:
          'Deactivate accounts immediately when they are no longer needed, including seasonal staff at the end of every tax season and contractors when their engagement ends.',
      },
      { id: '2', label: 'Require two-factor authentication.', done: false },
    ],
  },
  render: (args) => (
    <div className="max-w-sm">
      <ChecklistCard {...args} />
    </div>
  ),
};
