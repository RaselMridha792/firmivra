'use client';

import { ESIGN_ERRORS, type EsignSettings, PublishEsignConsentBody } from '@firmivra/types';
import { Button, Card, Modal } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { TextArea } from '../../../../setup/_components/fields';
import { CONSENTS, SETTINGS } from './keys';

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

/**
 * The e-signature consent every signer accepts before signing. Nothing can be sent until there is
 * one. A new version applies from then on; signers who accepted an older one keep theirs.
 */
export function ConsentCard({ s }: { s: EsignSettings }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const versions = useApiQuery(CONSENTS, () => api.esign.settings.consentVersions());
  const publish = useApiMutation(
    (body: PublishEsignConsentBody) => api.esign.settings.publishConsent(body),
    { invalidate: SETTINGS },
  );
  const current = s.consent;

  function check() {
    const parsed = PublishEsignConsentBody.safeParse({ bodyMarkdown: draft ?? '' });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    if (parsed.data.bodyMarkdown === current?.bodyMarkdown) {
      return setError('This is the text signers accept now.');
    }
    publish.reset();
    setConfirming(true);
  }
  function close() {
    setDraft(null);
    setError(undefined);
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold text-heading">E-signature consent</h2>
      {current ? (
        <>
          <p className="text-sm text-muted">
            Version {current.version}, published {when(current.publishedAt)}
            {current.publishedBy && ` by ${current.publishedBy.name}`}. Every signer accepts this
            before signing.
          </p>
          <div
            data-testid="consent-text"
            className="max-h-64 overflow-y-auto rounded-control border border-border bg-surface p-3 text-sm whitespace-pre-wrap text-text"
          >
            {current.bodyMarkdown}
          </div>
        </>
      ) : (
        <p className="text-sm text-danger">
          {s.canEdit
            ? 'No consent text yet. Requests cannot be sent until you publish one.'
            : 'No consent text yet. Requests cannot be sent until an Owner or Admin publishes one.'}
        </p>
      )}
      {s.canEdit &&
        (draft === null ? (
          <div>
            <Button variant="secondary" onClick={() => setDraft(current?.bodyMarkdown ?? '')}>
              {current ? 'Write a new version' : 'Write the consent text'}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <TextArea
              label="Consent text"
              rows={10}
              maxLength={20_000}
              value={draft}
              error={error}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(undefined);
              }}
            />
            <div className="flex flex-wrap gap-3">
              <Button onClick={check}>Publish</Button>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
            </div>
          </div>
        ))}
      {confirming && draft !== null && (
        <Modal open title="Publish this consent text?" onClose={() => setConfirming(false)}>
          <div className="flex max-w-xl flex-col gap-4">
            <p className="text-sm text-text">
              Signers accept it from now on. Those who already accepted an earlier version keep that
              one. A published version cannot be changed.
            </p>
            {publish.error && (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(publish.error, ESIGN_ERRORS)}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={publish.isPending}
                onClick={() =>
                  publish.mutate(
                    { bodyMarkdown: draft },
                    {
                      onSuccess: () => {
                        setConfirming(false);
                        close();
                      },
                    },
                  )
                }
              >
                {publish.isPending ? 'Publishing…' : 'Publish'}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Not yet
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {versions.isError && (
        <p className="text-sm text-muted">Earlier versions could not be loaded.</p>
      )}
      {(versions.data?.items.length ?? 0) > 1 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-link">Earlier versions</summary>
          <ul data-testid="consent-versions" className="mt-2 flex flex-col gap-1 text-muted">
            {versions.data?.items.slice(1).map((v) => (
              <li key={v.id}>
                Version {v.version}, published {when(v.publishedAt)}
                {v.publishedBy && ` by ${v.publishedBy.name}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
