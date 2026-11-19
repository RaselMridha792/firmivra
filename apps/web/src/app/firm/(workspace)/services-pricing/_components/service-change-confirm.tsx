'use client';

import { Button, Modal } from '@firmivra/ui';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { CATALOG_KEY } from './catalog-shared';

export type ServiceChange = 'archive' | 'deactivate';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Services & Pricing Review Two R5 and R12: before a service is archived or deactivated, the firm
 * sees its name, what links to it and what happens to each, and confirms. Cancel changes nothing;
 * an archived service stays under Archived with Restore, and history keeps it as it was.
 */
export function ServiceChangeConfirm({
  service,
  action,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  service: { id: string; name: string };
  action: ServiceChange;
  pending: boolean;
  /** The refusal, in the firm's words, when the change was not made. */
  error?: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const usage = useApiQuery([...CATALOG_KEY, 'usage', service.id], () =>
    api.servicesPricing.usage(service.id),
  );
  const archive = action === 'archive';
  const data = usage.data;
  const live = data?.packages.filter((p) => p.status !== 'ARCHIVED') ?? [];
  const lines = data
    ? [
        live.length
          ? `In ${plural(live.length, 'package', 'packages')}: ${live.map((p) => p.name).join(', ')}. ${live.length === 1 ? 'It keeps' : 'They keep'} the service, marked inactive, and cannot be activated again until it is replaced or removed.`
          : null,
        data.activeEngagements
          ? `${plural(data.activeEngagements, 'active client service keeps', 'active client services keep')} it as it is.`
          : null,
        data.openInvoices
          ? `${plural(data.openInvoices, 'open invoice keeps its', 'open invoices keep their')} lines as they are.`
          : null,
        data.appointmentTypes
          ? `${plural(data.appointmentTypes, 'appointment type still names', 'appointment types still name')} it.`
          : null,
      ].filter((l): l is string => !!l)
    : [];
  return (
    <Modal
      open
      title={`${archive ? 'Archive' : 'Deactivate'} ${service.name}?`}
      subtitle={
        archive
          ? 'It moves to Archived, where you can restore it.'
          : 'It moves to Inactive Services and cannot be added to new work until you activate it again.'
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
            data-testid="service-change-confirm"
          >
            {archive ? 'Confirm Archive' : 'Confirm Deactivate'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm" data-testid="service-change-impact">
        <h3 className="font-semibold text-heading">What this affects</h3>
        {usage.isPending ? (
          <p className="text-muted">Checking where it is used…</p>
        ) : usage.isError ? (
          <p className="text-muted">
            We could not check where it is used right now. You can still continue or cancel.
          </p>
        ) : lines.length ? (
          <ul className="list-disc space-y-1 pl-5 text-text">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : (
          <p className="text-text">It is not used anywhere yet.</p>
        )}
        <p className="rounded-lg bg-canvas p-3 text-text">
          What stays the same: past invoices, client services and the activity history keep this
          service exactly as it was.
        </p>
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
