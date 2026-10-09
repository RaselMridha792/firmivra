import type { Meta, StoryObj } from '@storybook/react-vite';
import { AuthFrame } from './auth-frame';
import { Button } from './button';
import { Input } from './input';
const meta = {
  title: 'Design System/Auth Frame',
  component: AuthFrame,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AuthFrame>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Admin: Story = {
  args: {
    site: 'admin',
    title: 'Welcome Back',
    children: (
      <form className="auth-form">
        <Input label="Email Address" />
        <Input label="Password" type="password" />
        <Button className="auth-submit">Sign In →</Button>
      </form>
    ),
  },
};
export const Firm: Story = { args: { ...Admin.args, site: 'firm' } };
