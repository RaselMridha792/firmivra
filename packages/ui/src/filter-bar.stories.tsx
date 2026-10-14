import type { Meta, StoryObj } from '@storybook/react-vite';
import { DotsThreeVertical, EnvelopeSimple, UserPlus } from '@phosphor-icons/react';
import {
  BulkBar,
  Checkbox,
  FilterBar,
  FilterChip,
  FilterGroup,
  IconButton,
  SearchField,
  Select,
} from './index';

const meta = { title: 'Design System/Filters', parameters: { layout: 'padded' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const any = (label: string) => [{ value: '', label }];
export const Filters: Story = {
  render: () => (
    <div className="flex min-h-96 flex-col gap-3">
      <FilterBar
        onReset={() => {}}
        more={
          <>
            <FilterGroup title="Client Status">
              <Checkbox label="Active" defaultChecked />
              <Checkbox label="Pending Documents" />
            </FilterGroup>
            <FilterGroup title="Service Type">
              <Checkbox label="Personal Tax" />
              <Checkbox label="Bookkeeping" />
            </FilterGroup>
            <FilterGroup title="Assigned Staff">
              <Select label="Staff" options={any('All Staff Members')} />
            </FilterGroup>
            <FilterGroup title="Balance Due">
              <Select label="Amount" options={any('Any Amount')} />
            </FilterGroup>
          </>
        }
      >
        <SearchField label="Search clients" placeholder="Search clients by name, email, phone…" />
        <Select label="Services" options={any('All Services')} className="w-48" />
      </FilterBar>
      <FilterChip label="Status: Active" onRemove={() => {}} />
    </div>
  ),
};
export const BulkActions: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <BulkBar
        count={3}
        noun="clients"
        actions={[
          { label: 'Send Email', icon: EnvelopeSimple, onClick: () => {} },
          { label: 'Assign Staff', icon: UserPlus, onClick: () => {} },
        ]}
      />
      <BulkBar
        count={0}
        noun="clients"
        actions={[{ label: 'Send Email', icon: EnvelopeSimple, onClick: () => {} }]}
      />
      <div className="flex gap-2">
        <IconButton icon={EnvelopeSimple} label="Email" tone="danger" />
        <IconButton icon={DotsThreeVertical} weight="bold" label="More" />
      </div>
    </div>
  ),
};
