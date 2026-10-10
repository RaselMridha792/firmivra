'use client';

import { ESIGN_ERRORS, type EsignPage, type EsignRequestDetail } from '@firmivra/types';
import { Button, Card, Modal } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, RotateCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { closeThumbFiles, PageThumb } from '../../../../../../../../components/esign/page-thumb';
import { api } from '../../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../../lib/query';
import { requestKey } from './steps';

type Rotation = EsignPage['rotation'];
const turn = (r: Rotation): Rotation => ((r + 90) % 360) as Rotation;

/**
 * The packet's pages in order, from every file: move a page earlier or later, turn it, or leave
 * it out. Each change saves the whole order at once (the API keeps fields with their page).
 */
export function PagePlan({ r, locked }: { r: EsignRequestDetail; locked: boolean }) {
  const queryClient = useQueryClient();
  const save = useApiMutation(
    async (pages: EsignPage[]) => {
      // A refetch already on its way would put the old order back over the answer.
      await queryClient.cancelQueries({ queryKey: requestKey(r.id) });
      return api.esign.putPagePlan(r.id, { pages });
    },
    { invalidate: requestKey(r.id) },
  );
  const [removing, setRemoving] = useState<number | null>(null);
  useEffect(() => closeThumbFiles, []);
  const pages = r.pagePlan;
  // Changes wait while a file is checked or removed: the order saved must be the current one.
  const ready = r.documents.every((d) => d.scanStatus === 'CLEAN');
  const busy = save.isPending || locked || !ready;
  if (pages.length === 0) return null;
  const fieldsOn = (i: number) => r.fields.filter((f) => f.pageIndex === i).length;

  function change(next: EsignPage[]) {
    save.mutate(next, {
      onSuccess: (detail) => queryClient.setQueryData(requestKey(r.id), detail),
    });
  }
  const remove = (i: number) => change(pages.filter((_, k) => k !== i));
  const move = (i: number, by: -1 | 1) => {
    const next = [...pages];
    const [page] = next.splice(i, 1);
    if (page) next.splice(i + by, 0, page);
    change(next);
  };

  return (
    <Card>
      <h2 className="mb-1 font-semibold text-heading">Pages ({pages.length})</h2>
      <p className="mb-4 text-sm text-muted">
        The signer sees the pages in this order. A page you remove is not sent; to get it back,
        remove its file and add the file again.
      </p>
      {!ready && (
        <p className="mb-4 text-sm text-muted">Pages show once every file has been checked.</p>
      )}
      <ol
        data-testid="page-plan"
        className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-4"
      >
        {pages.map((p, i) => {
          const doc = r.documents.find((d) => d.id === p.documentId);
          if (!doc) return null;
          const name = `Page ${i + 1}`;
          const from = `${doc.fileName}, page ${p.page + 1}`;
          return (
            <li key={`${p.documentId}:${p.page}`} className="flex flex-col items-center gap-2">
              {ready ? (
                <PageThumb
                  url={api.esign.documentContentUrl(r.id, doc.id)}
                  isPdf={doc.contentType === 'application/pdf'}
                  page={p.page}
                  rotation={p.rotation}
                  size={doc.pageSizes[p.page] ?? { width: 612, height: 792 }}
                  label={`${name}: ${from}`}
                />
              ) : null}
              <span className="text-sm font-medium text-heading">{name}</span>
              <span className="w-full truncate text-center text-xs text-muted" title={from}>
                {from}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  aria-label={`Move ${name} earlier`}
                  disabled={busy || i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowLeft aria-hidden className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Move ${name} later`}
                  disabled={busy || i === pages.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowRight aria-hidden className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Turn ${name} clockwise`}
                  // The API refuses to turn a page that has fields (PAGE_HAS_FIELDS).
                  title={fieldsOn(i) ? 'Move or remove its fields first' : undefined}
                  disabled={busy || fieldsOn(i) > 0}
                  onClick={() =>
                    change(
                      pages.map((x, k) => (k === i ? { ...x, rotation: turn(x.rotation) } : x)),
                    )
                  }
                >
                  <RotateCw aria-hidden className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Remove ${name}`}
                  disabled={busy || pages.length === 1}
                  onClick={() => (fieldsOn(i) ? setRemoving(i) : remove(i))}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      {removing !== null && (
        <Modal open title={`Remove Page ${removing + 1}?`} onClose={() => setRemoving(null)}>
          <div className="flex max-w-xl flex-col gap-4">
            <p className="text-sm text-text">
              Its {fieldsOn(removing)} {fieldsOn(removing) === 1 ? 'field goes' : 'fields go'} with
              it.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => {
                  remove(removing);
                  setRemoving(null);
                }}
              >
                Remove the page
              </Button>
              <Button variant="ghost" onClick={() => setRemoving(null)}>
                Keep it
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {save.error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {errorMessage(save.error, ESIGN_ERRORS)}
        </p>
      )}
    </Card>
  );
}
