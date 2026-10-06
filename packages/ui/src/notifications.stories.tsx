import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { NotificationBell, NotificationList, type NotificationItem } from './notifications';

const meta = {
  title: 'Design System/Notifications',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const sample: NotificationItem[] = [
  {
    id: 'example',
    title: 'Document received',
    message: 'A synthetic example for component review.',
    read: false,
    time: 'Just now',
    href: '/documents',
  },
];
function Demo() {
  const [items, setItems] = useState(sample);
  const read = (id: string) =>
    setItems(items.map((item) => (item.id === id ? { ...item, read: true } : item)));
  return (
    <div className="max-w-auth space-y-6 text-text">
      <NotificationBell items={items} onRead={read} />
      <NotificationList
        items={items}
        onRead={read}
        onReadAll={() => setItems(items.map((item) => ({ ...item, read: true })))}
      />
    </div>
  );
}
export const Interactive: Story = { render: () => <Demo /> };
export const Loading: Story = { render: () => <NotificationList items={[]} loading /> };
export const Empty: Story = { render: () => <NotificationList items={[]} /> };
export const Error: Story = {
  render: () => <NotificationList items={[]} error="Notifications could not be loaded." />,
};
