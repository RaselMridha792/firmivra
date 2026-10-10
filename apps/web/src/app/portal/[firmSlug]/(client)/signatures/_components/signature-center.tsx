'use client';

import {
  ESIGN_ERRORS,
  type MySignatureRow,
  type MySignatureState,
  type SignerCopyFile,
} from '@firmivra/types';
import { Badge, Button, Card, EmptyState, Tabs } from '@firmivra/ui';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';

type Tab = 'PENDING' | 'SIGNED';

const STATE: Record<MySignatureState, [string, 'warning' | 'info' | 'success' | 'neutral']> = {
  ACTION_NEEDED: ['Ready for you to sign', 'warning'],
  WAITING: ['Waiting on others', 'info'],
  COMPLETED: ['Completed', 'success'],
  DECLINED: ['Declined', 'neutral'],
  EXPIRED: ['Expired', 'neutral'],
  VOIDED: ['Cancelled by the firm', 'neutral'],
};

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const day = (iso: string) => DAY.format(new Date(iso));

/** A signed-in client never used a link: a closed request reads as closed. */
const ERRORS = {
  ...ESIGN_ERRORS,
  LINK_INVALID: 'This request is no longer open. It may have expired or been cancelled.',
  NOT_FOUND: 'This request is no longer open. It may have expired or been cancelled.',
};

/**
 * The client's Signature center: what their firm sent them to sign (sign now, or see who it waits
 * on) and what is done (download the signed copy and its certificate).
 */
export function SignatureCenter() {
  const { firmSlug } = useParams<{ firmSlug: string }>();
  const status = useApiQuery(['my-signatures', firmSlug, 'status'], () =>
    api.mySignatures(firmSlug).status(),
  );
  const [tab, setTab] = useState<Tab>('PENDING');
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <h1 data-testid="page-title" className="font-display text-3xl font-bold text-heading">
          Signatures
        </h1>
        <p className="text-sm text-muted">
          Documents we sent you to sign, and the ones you signed.
        </p>
      </div>
      <PageState query={status}>
        {(s) =>
          s.enabled ? (
            <Tabs
              label="Signatures"
              value={tab}
              onChange={(id) => setTab(id as Tab)}
              items={[
                {
                  id: 'PENDING',
                  label: 'To sign',
                  // Only the open tab asks for its list.
                  content: tab === 'PENDING' && <List slug={firmSlug} tab="PENDING" />,
                },
                {
                  id: 'SIGNED',
                  label: 'Done',
                  content: tab === 'SIGNED' && <List slug={firmSlug} tab="SIGNED" />,
                },
              ]}
            />
          ) : (
            <EmptyState
              title="No documents to sign"
              description="Your firm doesn't send documents to sign here."
            />
          )
        }
      </PageState>
    </div>
  );
}

function List({ slug, tab }: { slug: string; tab: Tab }) {
  const list = useQuery({
    queryKey: ['my-signatures', slug, tab],
    queryFn: () => api.mySignatures(slug).list({ tab }),
    // Back from signing, the list shows where things stand now.
    refetchOnMount: 'always',
  });
  return (
    <PageState
      query={list}
      isEmpty={(l) => l.items.length === 0}
      empty={tab === 'PENDING' ? 'Nothing is waiting for your signature.' : 'Nothing signed yet.'}
    >
      {(l) => (
        <ul data-testid="my-signatures" className="flex flex-col gap-4">
          {l.items.map((row) => (
            <Row key={row.recipientId} slug={slug} row={row} />
          ))}
        </ul>
      )}
    </PageState>
  );
}

function Row({ slug, row }: { slug: string; row: MySignatureRow }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // The follow-up runs in the hook, so it still happens when the user switches tab meanwhile.
  const start = useMutation({
    mutationFn: () => api.mySignatures(slug).startSigning(row.recipientId),
    onSuccess: () => router.push(`/${slug}/sign`),
    // Closed since the list loaded: show it as it is now.
    onError: () => queryClient.invalidateQueries({ queryKey: ['my-signatures', slug] }),
  });
  const download = useMutation({
    mutationFn: (file: SignerCopyFile) => api.mySignatures(slug).download(row.recipientId, file),
    onSuccess: ({ url }) => {
      // A five-minute link that storage sends as a download.
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      a.rel = 'noopener';
      a.click();
    },
  });
  const [label, tone] = STATE[row.state];
  const error = start.error ?? download.error;

  const save = (file: SignerCopyFile) => download.mutate(file);

  return (
    <li>
      <Card data-testid="my-signature" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-semibold break-words text-heading">{row.title}</h2>
            <p className="text-sm text-muted">From {row.senderName}</p>
          </div>
          <Badge tone={tone}>{label}</Badge>
        </div>
        <p className="text-sm text-text">
          Sent {day(row.sentAt)}
          {row.signedAt && ` · You signed ${day(row.signedAt)}`}
          {row.completedAt && ` · Completed ${day(row.completedAt)}`}
          {row.state === 'ACTION_NEEDED' && row.expiresAt && ` · Sign by ${day(row.expiresAt)}`}
        </p>
        {row.state === 'ACTION_NEEDED' && (
          <div>
            <Button
              // Stays off while the signer pages open: a second click would start a second session.
              disabled={start.isPending || start.isSuccess}
              // Signed in already: the signer pages open without an email code.
              onClick={() => start.mutate()}
            >
              {start.isPending || start.isSuccess ? 'Opening…' : 'Review and sign'}
            </Button>
          </div>
        )}
        {row.state === 'COMPLETED' && (
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" disabled={download.isPending} onClick={() => save('final')}>
              Download signed copy
            </Button>
            <Button
              variant="ghost"
              disabled={download.isPending}
              onClick={() => save('certificate')}
            >
              Certificate
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(error, ERRORS)}
          </p>
        )}
      </Card>
    </li>
  );
}
