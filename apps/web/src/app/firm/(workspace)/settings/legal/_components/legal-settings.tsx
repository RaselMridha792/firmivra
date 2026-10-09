'use client';

import {
  type LegalDocument,
  type LegalKind,
  type LegalVersion,
  PublishLegalDocumentRequest,
} from '@firmivra/types';
import { Button, Card, Modal, Tabs } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { TextArea } from '../../../../setup/_components/fields';

const KINDS = [
  { id: 'terms', label: 'Terms of Service' },
  { id: 'privacy', label: 'Privacy Policy' },
] as const;

const legalKey = (kind: LegalKind, version?: number) =>
  version ? ['firm-settings', 'legal', kind, version] : ['firm-settings', 'legal', kind];

const published = (doc: LegalVersion) =>
  `Version ${doc.version}, published ${new Date(doc.publishedAt).toLocaleDateString('en-US', {
    dateStyle: 'medium',
  })}`;

/**
 * Settings > Terms & Privacy: the firm's own texts, as versions. Publishing adds a version;
 * versions never change. The text is shown as plain text, never as HTML.
 */
export function LegalSettings() {
  const [kind, setKind] = useState<LegalKind>('terms');
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 data-testid="page-title" className="text-2xl font-semibold text-text">
          Terms &amp; Privacy
        </h1>
        <p className="text-sm text-muted">
          Clients see these at sign-up and in the portal. Clients can sign up once both are
          published.
        </p>
      </div>
      <Tabs
        label="Legal documents"
        value={kind}
        onChange={(id) => setKind(id === 'privacy' ? 'privacy' : 'terms')}
        items={KINDS.map(({ id, label }) => ({ id, label, content: <LegalPanel kind={id} /> }))}
      />
    </div>
  );
}

function LegalPanel({ kind }: { kind: LegalKind }) {
  const legal = useApiQuery(legalKey(kind), () => api.settings.getLegal(kind));
  const [viewing, setViewing] = useState<number | null>(null);
  return (
    <PageState query={legal}>
      {({ current, versions }) => (
        <div className="flex flex-col gap-4">
          <Card title={current ? published(current) : 'Not published yet'}>
            {current ? (
              <p data-testid="legal-current" className="whitespace-pre-wrap text-sm text-text">
                {current.body}
              </p>
            ) : (
              <p className="text-sm text-muted">Write the first version below.</p>
            )}
          </Card>
          <PublishForm key={current?.version ?? 0} kind={kind} current={current} />
          {versions.length > 1 ? (
            <Card title="Earlier versions">
              <ul className="flex flex-col gap-2">
                {versions.slice(1).map((version) => (
                  <li key={version.version} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-text">{published(version)}</span>
                    <Button variant="ghost" onClick={() => setViewing(version.version)}>
                      View version {version.version}
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Modal
            open={viewing !== null}
            title={`Version ${viewing ?? ''}`}
            onClose={() => setViewing(null)}
          >
            {viewing !== null ? <VersionText kind={kind} version={viewing} /> : null}
          </Modal>
        </div>
      )}
    </PageState>
  );
}

function VersionText({ kind, version }: { kind: LegalKind; version: number }) {
  const doc = useApiQuery(legalKey(kind, version), () =>
    api.settings.getLegalVersion(kind, version),
  );
  return (
    <PageState query={doc}>
      {(text) => <p className="whitespace-pre-wrap text-sm text-text">{text.body}</p>}
    </PageState>
  );
}

function PublishForm({ kind, current }: { kind: LegalKind; current: LegalDocument | null }) {
  const form = useForm({
    resolver: zodResolver(PublishLegalDocumentRequest),
    defaultValues: { body: current?.body ?? '' },
  });
  const publish = useApiMutation(
    (body: PublishLegalDocumentRequest) => api.settings.publishLegal(kind, body),
    { invalidate: legalKey(kind) },
  );
  const next = (current?.version ?? 0) + 1;
  return (
    <form
      onSubmit={form.handleSubmit((body) => publish.mutate(body))}
      noValidate
      className="flex flex-col items-start gap-3"
    >
      <div className="w-full">
        <TextArea
          label="New version"
          rows={10}
          error={form.formState.errors.body?.message}
          {...form.register('body')}
        />
      </div>
      <Button type="submit" disabled={publish.isPending}>
        {publish.isPending ? 'Publishing…' : `Publish version ${next}`}
      </Button>
      {publish.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(publish.error)}
        </p>
      ) : null}
    </form>
  );
}
