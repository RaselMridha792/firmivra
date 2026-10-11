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
