import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { NotificationBellButton, NotificationList } from './notification-bell';

const meta = {
  component: NotificationBellButton,
  args: { count: 3, open: false, onClick: fn() },
} satisfies Meta<typeof NotificationBellButton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Unread: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Notifications, 3 unread' }),
    );
    await expect(args.onClick).toHaveBeenCalled();
  },
};
export const Read: Story = { args: { count: 0 } };
export const LargeCount: Story = { args: { count: 120 } };
export const List: Story = {
  render: () => (
    <NotificationList
      pending={false}
      onOpen={fn()}
      items={[
        {
          id: '1',
          title: 'Document request answered',
          body: 'Jamie Sample answered your request.',
          when: 'Oct 11, 2026',
          unread: true,
          canOpen: true,
        },
        {
          id: '2',
          title: 'Account updated',
          body: 'Your account details changed.',
          when: 'Oct 10, 2026',
          unread: false,
          canOpen: false,
        },
      ]}
    />
  ),
};
