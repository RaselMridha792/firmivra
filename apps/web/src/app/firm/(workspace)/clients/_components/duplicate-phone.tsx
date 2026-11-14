'use client';

import { ApiRequestError, DuplicatePhoneDetails } from '@firmivra/types';
import { Badge, Button, Modal } from '@firmivra/ui';
import { ArrowSquareOut } from '@phosphor-icons/react';

/** The matches of a 409 DUPLICATE_PHONE, or null for any other error. */
export function duplicateOf(error: unknown): DuplicatePhoneDetails | null {
  if (!(error instanceof ApiRequestError) || error.code !== 'DUPLICATE_PHONE') return null;
  const parsed = DuplicatePhoneDetails.safeParse(error.rawDetails);
  return parsed.success ? parsed.data : { count: 1, matches: [] };
}

/**
 * Clients Review 2, Possible duplicate client (the owner's decision): another client of the firm
 * has this phone. Only the matches this member may see are listed, each with Open Existing (a new
 * tab, so the draft stays); Create Anyway sends it again, confirmed. Nothing is ever merged, and
 * the API records the confirmation.
 */
export function DuplicatePhoneDialog({
  details,
  confirmLabel,
  pending,
  onConfirm,
  onCancel,
}: {
  details: DuplicatePhoneDetails;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const hidden = details.count - details.matches.length;
  return (
    <Modal
      open
      title="Possible duplicate client"
      subtitle="Another client of your firm already has this phone number."
      onClose={onCancel}
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            Keep Editing
          </Button>
          <Button disabled={pending} onClick={onConfirm} data-testid="confirm-duplicate">
            {pending ? 'Saving…' : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text">
        Check it is not the same person or business before you go on. If it is, open the existing
        client instead; nothing is merged.
      </p>
      {details.matches.length ? (
        <ul className="mt-3 flex flex-col divide-y divide-divider" data-testid="duplicate-matches">
          {details.matches.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-heading">{m.name}</span>
                <span className="block text-xs text-muted">{m.clientNumber}</span>
              </span>
              {m.archived ? <Badge tone="neutral">Archived</Badge> : null}
              <a
                href={`/clients/${m.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm font-medium text-action underline"
              >
                Open Existing <ArrowSquareOut aria-hidden className="size-4" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {hidden > 0 ? (
        <p className="mt-2 text-xs text-muted">
          {hidden} more client{hidden === 1 ? '' : 's'} with this phone{' '}
          {hidden === 1 ? 'is' : 'are'} not assigned to you.
        </p>
      ) : null}
    </Modal>
  );
}
