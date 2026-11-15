'use client';

import { Button, Modal } from '@firmivra/ui';

/**
 * M21 (Messaging Review 2): Cancel with an unsaved message asks first, as every other form does;
 * Keep Editing stays, Discard Message closes without saving.
 */
export function LeaveDialog({
  open,
  onStay,
  onLeave,
}: {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
}) {
  return (
    <Modal
      open={open}
      title="Leave without saving?"
      onClose={onStay}
      footer={
        <>
          <Button variant="secondary" onClick={onStay}>
            Keep Editing
          </Button>
          <Button onClick={onLeave}>Discard Message</Button>
        </>
      }
    >
      <p className="text-sm text-text" data-testid="leave-unsaved">
        This message is not saved. Save it as a draft to finish it later, or discard it.
      </p>
    </Modal>
  );
}
