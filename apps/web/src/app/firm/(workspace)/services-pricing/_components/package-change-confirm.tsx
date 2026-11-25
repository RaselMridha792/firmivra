'use client';

import { Button, Modal } from '@firmivra/ui';

/**
 * Services & Pricing Review Two R12: before a package is deactivated or archived, the firm sees
 * what changes for clients and what stays as it was, and confirms. Cancel changes nothing.
 */
export function PackageChangeConfirm({
  name,
  action,
  pending,
  onConfirm,
  onCancel,
}: {
  name: string;
  action: 'archive' | 'deactivate';
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const archive = action === 'archive';
  return (
    <Modal
      open
      title={`${archive ? 'Archive' : 'Deactivate'} ${name}?`}
      subtitle={
        archive
          ? 'It moves to Archived, where you can restore it.'
          : 'It moves to Inactive until you activate it again.'
      }
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={archive ? 'danger' : 'primary'}
            disabled={pending}
            onClick={onConfirm}
            data-testid="package-change-confirm"
          >
            {archive ? 'Confirm Archive' : 'Confirm Deactivate'}
          </Button>
        </>
      }
    >
      <ul
        className="list-disc space-y-1 pl-5 text-sm text-text"
        data-testid="package-change-impact"
      >
        <li>
          Clients no longer see it in your portal, and its public link says it is not available.
        </li>
        <li>Its services stay as they are, and stay available on their own.</li>
        <li>Invoices, client services and history from it keep exactly what was sold.</li>
      </ul>
    </Modal>
  );
}
