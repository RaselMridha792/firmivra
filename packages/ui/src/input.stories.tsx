import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from './input';

const meta = {
  component: Input,
  args: { label: 'Email', type: 'email', placeholder: 'you@example.com' },
} satisfies Meta<typeof Input>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithError: Story = { args: { error: 'Enter a valid email address' } };
export const WithHint: Story = {
  args: {
    label: 'Current Customers',
    type: 'text',
    placeholder: undefined,
    hint: 'Describe who currently buys your products or services.',
  },
};
