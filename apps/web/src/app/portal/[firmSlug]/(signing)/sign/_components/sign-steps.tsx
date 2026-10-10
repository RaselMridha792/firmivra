'use client';

import { ESIGN_ERRORS, type SignerCopyFile } from '@firmivra/types';
import { Button, Card, EmptyState } from '@firmivra/ui';
import { PageState } from '../../../../../../components/page-state';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { useLost } from './lost';
import { SignView } from './sign-view';
import type { StepProps } from './signer-page';

const message = (e: unknown) => (e ? errorMessage(e, ESIGN_ERRORS) : undefined);

/** SIGN: the document with the signer's fields (sign-view.tsx). */
export function SignStep({ signing, firmSlug, opening, onState, onLost }: StepProps) {
  const envelope = useApiQuery(['signing', firmSlug, opening, 'envelope'], () =>
    signing.envelope(),
  );
  useLost(envelope.error, onLost);
  return (
    <PageState query={envelope} isEmpty={() => false}>
      {(e) => <SignView signing={signing} envelope={e} onState={onState} />}
    </PageState>
  );
}

/** COPY: a completed request's signed document and certificate, from the copy link. */
export function CopyStep({ signing, firmSlug, opening, onLost }: StepProps) {
  const copy = useApiQuery(['signing', firmSlug, opening, 'copy'], () => signing.copy());
  useLost(copy.error, onLost);
  const download = useApiMutation((file: SignerCopyFile) => signing.downloadCopy(file));
  return (
    <Card title="Your signed copy">
      <PageState query={copy} isEmpty={() => false}>
        {(c) => (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text">
              Everyone has signed. Completed on{' '}
              {new Date(c.completedAt).toLocaleDateString(undefined, { dateStyle: 'long' })}.
            </p>
            <ul className="flex flex-col gap-2">
              {c.files.map((f) => (
                <li key={f.file} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-text">{f.fileName}</span>
                  <Button
                    variant="secondary"
                    disabled={download.isPending}
                    onClick={() =>
                      download.mutate(f.file, {
                        onSuccess: (link) => window.location.assign(link.url),
                        onError: onLost,
                      })
                    }
                  >
                    {f.file === 'final' ? 'Download the document' : 'Download the certificate'}
                  </Button>
                </li>
              ))}
            </ul>
            {download.error && (
              <p role="alert" className="text-sm text-danger">
                {message(download.error)}
              </p>
            )}
          </div>
        )}
      </PageState>
    </Card>
  );
}

/** WAITING, DONE, DECLINED and CLOSED: nothing to do here (now or any more). */
export function StatusStep({ state }: StepProps) {
  const sender = state.senderName;
  const closed: Record<string, string> = {
    COMPLETED: 'Everyone has signed. This request is complete.',
    EXPIRED: `This request has expired. Ask ${sender} to send it again if you still need to sign.`,
    VOIDED: `${sender} cancelled this request. There is nothing for you to sign.`,
    DECLINED: 'Someone declined this request, so it is closed.',
  };
  const text = {
    WAITING: {
      title: 'Not your turn yet',
      description: `Someone else signs before you. We'll email you when it's your turn.`,
    },
    DONE: {
      title: "You're done",
      description:
        "Thank you. We'll email you a link to your copy once everyone has signed. You can close this page.",
    },
    DECLINED: {
      title: 'You declined',
      description: `You declined to sign. ${sender} has been told.`,
    },
    CLOSED: {
      title: 'This request is closed',
      description:
        (state.requestStatus && closed[state.requestStatus]) ??
        'This request is closed. There is nothing more to sign.',
    },
  }[state.step as 'WAITING' | 'DONE' | 'DECLINED' | 'CLOSED'];
  return <EmptyState title={text.title} description={text.description} />;
}
