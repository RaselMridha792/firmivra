'use client';

import type { OutboundMessage } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { OriginLink } from '../../../../../components/origin-link';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { localParts } from '../../calendar/_components/time';

const KEY = ['messages'] as const;

/**
 * M24/M30 (Messaging Review 2): this client's drafts and scheduled messages, under the
 * conversation, with Edit (New Message, and Back comes here) and Cancel (asked first; nothing is
 * sent). Staff see their own, as in New Message.
 */
export function PendingMessages({
  clientId,
  onNotice,
}: {
  clientId: string;
  /** The screen's own toast; without one the result shows here (the client's Messages tab). */
  onNotice?: (t: string, tone: 'success' | 'error') => void;
}) {
  const list = useApiQuery([...KEY, 'outbound', 'client', clientId], () =>
    api.messages.outbound.list({ clientId }),
  );
  const qc = useQueryClient();
  const [canceling, setCanceling] = useState<OutboundMessage>();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; tone: 'success' | 'error' }>();
  const tell = (text: string, tone: 'success' | 'error') =>
    onNotice ? onNotice(text, tone) : setSaid({ text, tone });
  const items = list.data?.items ?? [];
  if (items.length === 0) {
    return said ? (
      <p role="status" className="text-sm text-success">
        {said.text}
      </p>
    ) : null;
  }
  const cancel = async (m: OutboundMessage) => {
    setBusy(true);
    try {
      await api.messages.outbound.cancel(m.id, { version: m.updatedAt });
      tell(m.status === 'SCHEDULED' ? 'Scheduled message canceled.' : 'Draft canceled.', 'success');
      setCanceling(undefined);
      // This list and New Message's Drafts and Scheduled.
      await qc.invalidateQueries({ queryKey: [...KEY, 'outbound'] });
    } catch (e) {
      tell(errorMessage(e), 'error');
    }
    setBusy(false);
  };
  return (
    <section
      aria-label="Drafts and Scheduled"
      className="flex flex-col gap-2 border-t border-divider pt-3"
      data-testid="client-pending"
    >
      <h3 className="text-sm font-semibold text-heading">Drafts and Scheduled</h3>
      {said ? (
        <p
          role="status"
          className={`text-sm ${said.tone === 'error' ? 'text-danger' : 'text-success'}`}
        >
          {said.text}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1 text-sm">
        {items.map((m) => {
          const at = m.scheduledFor ? localParts(m.scheduledFor, m.timezone) : null;
          return (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                <span className="font-medium text-heading">{m.subject || m.body.slice(0, 40)}</span>
                <span className="text-muted">
                  {' · '}
                  {at ? `Scheduled for ${at.date} ${at.time} (${m.timezone})` : 'Draft'}
                </span>
              </span>
              <span className="flex shrink-0 gap-3">
                <OriginLink href={`/messages/new?id=${m.id}`} className="font-medium text-link">
                  Edit
                </OriginLink>
                <button
                  type="button"
                  className="font-medium text-danger"
                  onClick={() => setCanceling(m)}
                >
                  Cancel
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <Modal
        open={canceling !== undefined}
        title={
          canceling?.status === 'SCHEDULED'
            ? 'Cancel this scheduled message?'
            : 'Cancel this draft?'
        }
        onClose={() => setCanceling(undefined)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCanceling(undefined)}>
              Keep It
            </Button>
            <Button disabled={busy} onClick={() => canceling && void cancel(canceling)}>
              {busy ? 'Canceling…' : 'Cancel Message'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">Nothing is sent. It stays in the history as canceled.</p>
      </Modal>
    </section>
  );
}
