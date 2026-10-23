import { useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Archive, Eye, PencilSimple, Trash } from '@phosphor-icons/react';
import { ActionMenu, Button, Drawer, Modal, Stepper, Tabs, type TabsVariant } from './index';

const meta = { title: 'Design System/Navigation and overlays' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const items = ['All Clients', 'Active', 'New'].map((label, i) => ({
  id: label,
  label,
  count: [127, 98, 24][i],
}));
function TabsDemo({ variant }: { variant: TabsVariant }) {
  const [value, setValue] = useState('All Clients');
  return <Tabs label="Clients" variant={variant} items={items} value={value} onChange={setValue} />;
}
export const TabVariants: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="flex flex-col gap-6">
      {(['underline', 'pill', 'segmented', 'folder'] as const).map((v) => (
        <TabsDemo key={v} variant={v} />
      ))}
    </div>
  ),
};

const steps = [
  'Account Information',
  'Role & Permissions',
  'Access & Security',
  'Additional Details',
].map((label) => ({ id: label, label }));
export const WizardStepper: Story = {
  parameters: { layout: 'padded' },
  render: () => <Stepper variant="wizard" steps={steps} current="Role & Permissions" />,
};

const menu = [
  {
    title: 'Invoice',
    items: [
      { label: 'View Invoice', icon: Eye, onSelect: () => {} },
      { label: 'Edit Invoice', icon: PencilSimple, onSelect: () => {} },
    ],
  },
  {
    title: 'Manage Invoice',
    items: [
      { label: 'Archive Invoice', icon: Archive, onSelect: () => {}, submenu: true },
      {
        label: 'Delete Invoice',
        icon: Trash,
        onSelect: () => {},
        danger: true,
        restricted: 'Admin Only',
      },
    ],
  },
];
export const DropdownMenu: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="h-80">
      <ActionMenu
        label="Actions"
        align="left"
        trigger="Actions"
        sections={menu}
        footer="Actions marked Admin Only need administrator permissions."
      />
    </div>
  ),
};

function Overlay({
  children,
  kind,
  size,
}: {
  children: ReactNode;
  kind: 'modal' | 'drawer';
  size?: 'md' | 'wide';
}) {
  const [open, setOpen] = useState(false);
  const footer = (
    <>
      <Button variant="secondary" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      <Button onClick={() => setOpen(false)}>Apply</Button>
    </>
  );
  const props = {
    open,
    title: 'Choose Recipients',
    subtitle: 'Select who gets this message.',
    footer,
    onClose: () => setOpen(false),
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open {kind}</Button>
      {kind === 'modal' ? (
        <Modal {...props}>{children}</Modal>
      ) : (
        <Drawer {...props} size={size}>
          {children}
        </Drawer>
      )}
    </>
  );
}
export const ModalWithFooter: Story = {
  render: () => <Overlay kind="modal">1,154 recipients</Overlay>,
};
export const SidePanel: Story = { render: () => <Overlay kind="drawer">1,154 recipients</Overlay> };
/** A whole builder in a panel (Create Campaign on Leads). */
export const WideSidePanel: Story = {
  render: () => (
    <Overlay kind="drawer" size="wide">
      The Communications builder
    </Overlay>
  ),
};
