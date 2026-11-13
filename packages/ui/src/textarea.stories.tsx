import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Textarea } from './textarea';
const meta = {
  component: Textarea,
  args: { label: 'Internal note', maxLength: 10000 },
} satisfies Meta<typeof Textarea>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByLabelText('Internal note');
    await expect(input).toHaveAttribute('maxlength', '10000');
  },
};
export const WithError: Story = { args: { error: 'Enter a note.' } };
export const WithHint: Story = {
  args: {
    label: 'Efficiency Opportunities',
    hint: 'Describe changes that could save time, reduce costs, improve quality, or help the business serve customers better.',
  },
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByLabelText('Efficiency Opportunities');
    await expect(box).toHaveAccessibleDescription(
      'Describe changes that could save time, reduce costs, improve quality, or help the business serve customers better.',
    );
  },
};
