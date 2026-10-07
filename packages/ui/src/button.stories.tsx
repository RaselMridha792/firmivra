import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';

const meta = { component: Button, args: { children: 'Continue' } } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Ghost: Story = { args: { variant: 'ghost' } };
export const Outline: Story = { args: { variant: 'outline', children: 'Create an Account' } };
export const OutlineDisabled: Story = {
  args: { variant: 'outline', children: 'Create an Account', disabled: true },
};
export const Dark: Story = { args: { variant: 'dark' } };
export const DarkDisabled: Story = { args: { variant: 'dark', disabled: true } };
export const Disabled: Story = { args: { disabled: true } };
