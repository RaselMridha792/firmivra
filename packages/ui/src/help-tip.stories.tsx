import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, Card, HelpTip, Modal } from './index';

const meta = { title: 'Design System/Help icon' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** Beside a section title, a field label and at the window's edge (the bubble stays inside). */
export const BesideTitlesAndLabels: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="flex flex-col gap-6">
      <Card>
        <h2 className="flex items-center gap-1.5 text-lg font-semibold text-heading">
          Merge Fields
          <HelpTip topic="Merge fields">
            Inserts a client, firm or appointment detail at the cursor. A field with no value for a
            recipient uses its fallback, and Review lists any that are still missing.
          </HelpTip>
        </h2>
      </Card>
      <label className="flex items-center gap-1.5 text-sm font-semibold text-heading">
        Attachments
        <HelpTip topic="Attachments">
          PDF, DOCX, XLSX, JPG or PNG, up to 10 MB each. Files are scanned before anyone can open
          them.
        </HelpTip>
      </label>
      <div className="flex justify-end">
        <span className="flex items-center gap-1.5 text-sm text-heading">
          At the right edge
          <HelpTip topic="Placement">The bubble moves left to stay inside the window.</HelpTip>
        </span>
      </div>
    </div>
  ),
};

function InDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Modal open={open} title="Choose Recipients" onClose={() => setOpen(false)}>
        <p className="flex items-center gap-1.5 text-sm text-heading">
          Eligible contacts
          <HelpTip topic="Eligible contacts">
            Only your firm&apos;s contacts who can receive this channel. The first Escape closes
            this bubble, the next one the dialog.
          </HelpTip>
        </p>
      </Modal>
    </>
  );
}
/** In a dialog the bubble is drawn inside it, above its content. */
export const InADialog: Story = { render: () => <InDialog /> };
