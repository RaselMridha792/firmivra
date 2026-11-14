'use client';

import type { Engagement, FormDeliveryChannel } from '@firmivra/types';
import { Button, Input, Modal, Select, Textarea } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorCode } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';

// Clients Review 2 (G7): Send Message, Request Document and Send Intake Form for the selected
// clients. Each goes through the same endpoint as for one client (its checks and audit row), one
// client at a time, and the result says who got it and who did not, and why.

type Chosen = { id: string; displayName: string };

/** New Message takes at most this many preset clients from the list (the URL stays short). */
export const MAX_MESSAGE_CLIENTS = 100;

/** Bulk Send Message: New Message with the selected clients chosen. */
export const bulkMessageHref = (clients: Chosen[]) =>
  `/messages/new?clientIds=${clients
    .slice(0, MAX_MESSAGE_CLIENTS)
    .map((c) => c.id)
    .join(',')}`;

/** Why one client was skipped, in the toast's words. */
const REASONS: Record<string, string> = {
  NO_SERVICE: 'no active service of this kind',
  NO_ENGAGEMENT: "no active service for this form's service",
  ENGAGEMENT_NOT_ACTIVE: 'the service is not active',
  FORM_ALREADY_OPEN: 'already has this form open',
  PORTAL_UNAVAILABLE: 'no client portal sign-in yet',
  CLIENT_ARCHIVED: 'archived',
  FORBIDDEN: 'not permitted',
  NOT_FOUND: 'not found',
};

type Outcome = { client: Chosen; skipped?: string };

/** "3 clients got the form. 1 skipped: Ana Ruiz (already has this form open)." */
export function outreachSummary(outcomes: Outcome[], done: string) {
  const sent = outcomes.filter((o) => !o.skipped).length;
  const skipped = outcomes.filter((o) => o.skipped);
  const head = `${sent} ${sent === 1 ? 'client' : 'clients'} ${done}.`;
  if (!skipped.length) return head;
  const who = skipped
    .map((o) => `${o.client.displayName} (${REASONS[o.skipped!] ?? 'could not be sent'})`)
    .join(', ');
  return `${head} ${skipped.length} skipped: ${who}.`;
}

/** One call per client, in turn; a refusal is that client's reason, never the whole run's. */
function useEachClient(clients: Chosen[]) {
  const [progress, setProgress] = useState<number | null>(null);
  const run = async (one: (c: Chosen) => Promise<string | void>) => {
    const outcomes: Outcome[] = [];
    for (const [i, client] of clients.entries()) {
      setProgress(i + 1);
      try {
        const skipped = await one(client);
        outcomes.push(skipped ? { client, skipped } : { client });
      } catch (e) {
        outcomes.push({ client, skipped: errorCode(e) ?? 'FAILED' });
      }
    }
    setProgress(null);
    return outcomes;
  };
  return { run, progress };
}

const subtitle = (clients: Chosen[]) =>
  clients.length === 1 ? clients[0]!.displayName : `${clients.length} selected clients`;

export function BulkRequestDocumentDialog({
  clients,
  onClose,
  onDone,
}: {
  clients: Chosen[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const qc = useQueryClient();
  const ids = clients.map((c) => c.id);
  // Each client's active services: the request belongs to one of them (its engagement).
  const services = useApiQuery(['clients', 'bulk-request-services', ...ids], () =>
    Promise.all(
      clients.map((c) =>
        api.engagements.listForClient(c.id, { status: 'ACTIVE' }).catch((): Engagement[] => []),
      ),
    ),
  );
  const categories = useApiQuery(['document-categories'], () => api.documents.categories());
  const [serviceId, setServiceId] = useState('');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [touched, setTouched] = useState(false);
  const { run, progress } = useEachClient(clients);

  const kinds = new Map<string, { name: string; count: number }>();
  for (const list of services.data ?? []) {
    for (const id of new Set(list.map((e) => e.service.id))) {
      const name = list.find((e) => e.service.id === id)!.service.name;
      kinds.set(id, { name, count: (kinds.get(id)?.count ?? 0) + 1 });
    }
  }
  const missing = touched && (!serviceId || !title.trim());

  const submit = async () => {
    setTouched(true);
    if (!serviceId || !title.trim()) return;
    const outcomes = await run(async (client) => {
      const list = services.data?.[ids.indexOf(client.id)] ?? [];
      // The newest active engagement of that service (the list comes newest first).
      const engagement = list.find((e) => e.service.id === serviceId);
      if (!engagement) return 'NO_SERVICE';
      await api.documents.createRequest(client.id, {
        serviceId: engagement.id,
        title: title.trim(),
        instructions: instructions.trim(),
        categoryId: categoryId || null,
        dueOn,
      });
    });
    void qc.invalidateQueries({ queryKey: ['document-requests'] });
    onDone(outreachSummary(outcomes, 'asked for the document'));
  };

  return (
    <Modal
      open
      title="Request Document"
      subtitle={subtitle(clients)}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={progress !== null}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={progress !== null || services.isPending}>
            {progress !== null
              ? `Requesting ${progress} of ${clients.length}…`
              : 'Request Document'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="bulk-request-dialog">
        <p className="text-sm text-text">
          Each client gets their own request on the service you choose. Clients without that service
          active are skipped and named afterwards.
        </p>
        <Select
          label="Service"
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          error={touched && !serviceId ? 'Choose a service' : undefined}
          options={[
            {
              value: '',
              label: services.isPending
                ? 'Loading services…'
                : kinds.size
                  ? 'Choose a service'
                  : 'No active service on these clients',
            },
            ...[...kinds].map(([id, k]) => ({
              value: id,
              label: `${k.name} (${k.count} of ${clients.length})`,
            })),
          ]}
        />
        <Input
          label="Document title"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={touched && !title.trim() ? 'Say which document you need' : undefined}
        />
        <Input
          label="Instructions (optional)"
          maxLength={1000}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
        <Select
          label="Category (optional)"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          options={[
            { value: '', label: 'No category' },
            ...(categories.data ?? [])
              .filter((c) => !c.archivedAt)
              .map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <Input
          label="Due date (optional)"
          type="date"
          value={dueOn}
          onChange={(e) => setDueOn(e.target.value)}
        />
        {missing ? (
          <p role="alert" className="text-sm text-danger">
            Choose a service and say which document you need.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

export function BulkSendIntakeDialog({
  clients,
  onClose,
  onDone,
}: {
  clients: Chosen[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const qc = useQueryClient();
  const forms = useApiQuery(['intake-forms', 'published', 'for-bulk'], () =>
    api.intakeForms.forms({ templates: 'all', status: 'PUBLISHED' }),
  );
  const [formId, setFormId] = useState('');
  const [channel, setChannel] = useState<FormDeliveryChannel>('EMAIL');
  const [dueOn, setDueOn] = useState('');
  const formName = forms.data?.find((f) => f.id === formId)?.name ?? 'the intake form';
  const [subject, setSubject] = useState<string>();
  const [message, setMessage] = useState<string>();
  const subjectText = subject ?? `Please complete ${formName}`;
  const messageText = message ?? `Please complete ${formName}. It helps us prepare your service.`;
  // One key per client per dialog: a retried send returns the first form, never a second one.
  const [keys] = useState(() => new Map(clients.map((c) => [c.id, crypto.randomUUID()])));
  const [touched, setTouched] = useState(false);
  const { run, progress } = useEachClient(clients);

  const submit = async () => {
    setTouched(true);
    if (!formId || !subjectText.trim() || !messageText.trim()) return;
    const outcomes = await run(async (client) => {
      await api.intakeForms.send({
        idempotencyKey: keys.get(client.id)!,
        recipient: { kind: 'CLIENT', id: client.id },
        formId,
        channel,
        subject: subjectText.trim(),
        message: messageText.trim(),
        dueOn: dueOn || null,
        allowSaveAndContinue: true,
        sendMeCopy: false,
      });
    });
    void qc.invalidateQueries({ queryKey: ['intake-forms'] });
    onDone(outreachSummary(outcomes, 'got the form'));
  };

  return (
    <Modal
      open
      title="Send Intake Form"
      subtitle={subtitle(clients)}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={progress !== null}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={progress !== null}>
            {progress !== null ? `Sending ${progress} of ${clients.length}…` : 'Send Form'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="bulk-intake-dialog">
        <p className="text-sm text-text">
          Each client gets the form on their active service for it. Clients who already have it
          open, or have no such service, are skipped and named afterwards.
        </p>
        <Select
          label="Form"
          value={formId}
          onChange={(e) => setFormId(e.target.value)}
          error={touched && !formId ? 'Choose a form' : undefined}
          options={[
            { value: '', label: forms.isPending ? 'Loading forms…' : 'Choose a form' },
            ...(forms.data ?? []).map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
        <Select
          label="Send by"
          value={channel}
          onChange={(e) => setChannel(e.target.value as FormDeliveryChannel)}
          options={[
            { value: 'EMAIL', label: 'Email' },
            { value: 'PORTAL', label: 'Client portal' },
          ]}
        />
        <Input
          label="Subject"
          maxLength={200}
          value={subjectText}
          onChange={(e) => setSubject(e.target.value)}
          error={touched && !subjectText.trim() ? 'Enter a subject' : undefined}
        />
        <Textarea
          label="Message"
          rows={3}
          maxLength={500}
          value={messageText}
          onChange={(e) => setMessage(e.target.value)}
        />
        <Input
          label="Due date (optional)"
          type="date"
          value={dueOn}
          onChange={(e) => setDueOn(e.target.value)}
        />
      </div>
    </Modal>
  );
}
