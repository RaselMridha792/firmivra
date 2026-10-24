'use client';

import type { RequestItem, RequestPacketDetail } from '@firmivra/types';
import { Button, Toggle } from '@firmivra/ui';
import { DownloadSimple, Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { RowMenu } from '../../../../team/_components/row-menu';
import { type DraftItem } from '../../new/_components/request-draft';
import { DocIcon, ItemDialog, newItem, Section } from '../../new/_components/request-sections';
import { formatTime, ITEM_LOOKS, liveItems, type PacketActions } from './detail-parts';

const SCAN: Record<string, string> = {
  PENDING: 'Being checked for viruses',
  INFECTED: 'Blocked: a virus was found',
  FAILED: 'Could not be checked',
};

export interface ChecklistHandlers {
  download: (documentId: string) => void;
  accept: (item: RequestItem) => void;
  replace: (item: RequestItem) => void;
  setRequired: (item: RequestItem, required: boolean) => void;
  remove: (item: RequestItem) => void;
  add: (item: DraftItem) => Promise<boolean>;
}

/** The request's documents, what came in for each, and what staff can do with it. */
export function RequestChecklist({
  packet,
  can,
  busy,
  on,
}: {
  packet: RequestPacketDetail;
  can: PacketActions;
  busy: boolean;
  on: ChecklistHandlers;
}) {
  const [adding, setAdding] = useState<DraftItem | null>(null);
  const items = liveItems(packet);
  return (
    <Section
      title="Requested Documents"
      subtitle={`${packet.items.received} of ${packet.items.total} received · ${packet.items.required} required`}
      testId="request-checklist"
    >
      {items.length === 0 ? (
        <p className="rounded-control bg-canvas px-4 py-6 text-center text-sm text-muted">
          No documents on this request yet.
          {can.editDraft ? ' Add the documents the client should upload.' : ''}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-divider">
          {items.map((item) => {
            const look = ITEM_LOOKS[item.status];
            return (
              <li key={item.id} data-testid="checklist-item" className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-start gap-3">
                  <DocIcon />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-heading">{item.title}</p>
                    {item.instructions ? (
                      <p className="text-sm text-text">{item.instructions}</p>
                    ) : null}
                    {item.statusNote ? (
                      <p className="mt-1 text-sm text-muted">
                        {item.status === 'NOT_AVAILABLE' ? 'Client: ' : 'Asked again: '}
                        {item.statusNote}
                      </p>
                    ) : null}
                  </div>
                  {can.editDraft ? (
                    <label className="flex items-center gap-2 text-sm text-heading">
                      <Toggle
                        label={`${item.title} is required`}
                        checked={item.required}
                        disabled={busy}
                        onChange={(required) => on.setRequired(item, required)}
                      />
                      Required
                    </label>
                  ) : (
                    <span className="text-xs font-medium text-muted">
                      {item.required ? 'Required' : 'Optional'}
                    </span>
                  )}
                  <span className={`rounded-pill px-2.5 py-0.5 text-xs font-semibold ${look.tone}`}>
                    {look.label}
                  </span>
                  {can.editDraft ? (
                    <RowMenu
                      label={`Actions for ${item.title}`}
                      items={[{ label: 'Remove', danger: true, onSelect: () => on.remove(item) }]}
                    />
                  ) : null}
                </div>
                {item.documents.length ? (
                  <ul aria-label={`Files for ${item.title}`} className="ml-11 flex flex-col gap-2">
                    {item.documents.map((d) => (
                      <li
                        key={d.id}
                        className="flex flex-wrap items-center gap-3 rounded-control bg-canvas px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-heading">
                          {d.fileName}
                        </span>
                        <span className="text-xs text-muted">{formatTime(d.createdAt)}</span>
                        {d.scanStatus === 'CLEAN' ? (
                          <button
                            type="button"
                            onClick={() => on.download(d.id)}
                            aria-label={`Download ${d.fileName}`}
                            className="inline-flex min-h-9 items-center gap-1 rounded-control px-2 font-medium text-action hover:bg-accent-soft"
                          >
                            <DownloadSimple aria-hidden weight="bold" className="size-4" />
                            Download
                          </button>
                        ) : (
                          <span className="text-xs font-medium text-warning">
                            {SCAN[d.scanStatus]}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {can.review && item.status === 'SUBMITTED' ? (
                  <div className="ml-11 flex flex-wrap gap-2">
                    <Button disabled={busy} onClick={() => on.accept(item)}>
                      Accept
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => on.replace(item)}>
                      Request Replacement
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {can.editDraft ? (
        <button
          type="button"
          onClick={() => setAdding(newItem())}
          className="inline-flex items-center gap-2 self-start font-medium text-action underline"
        >
          <Plus aria-hidden weight="bold" className="size-4" />
          Add Document
        </button>
      ) : null}
      <ItemDialog
        item={adding}
        onClose={() => setAdding(null)}
        onSave={(item) => void on.add(item).then((ok) => ok && setAdding(null))}
      />
    </Section>
  );
}
