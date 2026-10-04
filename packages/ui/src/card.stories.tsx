import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card } from './card';

const meta = {
  component: Card,
  args: { title: 'Welcome back', children: 'Card content uses the shared tokens.' },
} satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
