import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ShieldCheck } from '@phosphor-icons/react';
import { DateRangePicker, FormField, FormSection, Input, Select } from './index';

const meta = { title: 'Design System/Forms', parameters: { layout: 'padded' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function Range() {
  const [value, setValue] = useState({ from: '', to: '' });
  return <DateRangePicker label="Due Date / Deadline" value={value} onChange={setValue} />;
}
export const DateRange: Story = { render: () => <Range /> };

export const Sections: Story = {
  render: () => (
    <div className="flex max-w-3xl flex-col gap-4">
      <FormSection
        step={1}
        title="Account Information"
        subtitle="Enter the team member's contact information."
      >
        <Input label="First Name *" placeholder="Enter first name" />
        <Input label="Last Name *" placeholder="Enter last name" error="Last name is required." />
        <Input label="Work Email *" placeholder="name@yourfirm.com" />
        <Input label="Phone Number (Optional)" placeholder="(XXX) XXX-XXXX" />
      </FormSection>
      <FormSection
        icon={ShieldCheck}
        title="Role & Permissions"
        subtitle="Assign a role and department."
      >
        <Select label="Role *" options={[{ value: '', label: 'Select a role' }]} />
        <FormField
          label="Start Date"
          htmlFor="start"
          required
          hint="Shown on the staff profile."
          counter="0/10"
        >
          <input
            id="start"
            type="date"
            className="h-10 rounded-control border border-divider bg-surface px-3 text-sm"
          />
        </FormField>
      </FormSection>
    </div>
  ),
};
