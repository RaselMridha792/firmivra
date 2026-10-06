'use client';

import { useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  Modal,
  Select,
  Textarea,
  type Tone,
} from '@firmivra/ui';
import { useWorkspace } from '../components/workspace-context';

export function PageHeading({
  title,
  description,
  action,
  display = false,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  display?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className={`text-3xl font-bold text-heading ${display ? 'font-display' : ''}`}>
          {title}
        </h1>
        <p className="mt-2 text-sm text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}
export function DataNotice() {
  const { preview } = useWorkspace();
  return preview ? null : (
    <Alert title="Records are not available right now">
      You can view this page, but changes cannot be saved yet.
    </Alert>
  );
}
export function Status({ value }: { value: string }) {
  const tone: Tone = [
    'paid',
    'complete',
    'completed',
    'approved',
    'active',
    'done',
    'available',
  ].includes(value.toLowerCase())
    ? 'success'
    : /declined|blocked|overdue/i.test(value)
      ? 'danger'
      : /pending|due|awaiting|invited/i.test(value)
        ? 'warning'
        : 'info';
  return <Badge tone={tone}>{value}</Badge>;
}
export function RecordLink({ href, children }: { href: string; children: ReactNode }) {
  const { preview } = useWorkspace();
  return (
    <a
      className="inline-flex min-h-11 items-center text-link underline"
      href={`${href}${preview ? '?preview=1' : ''}`}
    >
      {children}
    </a>
  );
}
export function UnavailableAction({
  label,
  title,
  children,
  danger = false,
}: {
  label: string;
  title?: string;
  children?: ReactNode;
  danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={danger ? 'danger' : 'primary'} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal title={title ?? label} open={open} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          {children}
          <Alert title="This action is not available yet">
            No changes have been made. Close this window to return to your work.
          </Alert>
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled variant={danger ? 'danger' : 'primary'}>
              {label}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
export function ReasonAction({ label, danger = false }: { label: string; danger?: boolean }) {
  return (
    <UnavailableAction label={label} danger={danger}>
      <Textarea label="Reason" maxLength={4000} required />
    </UnavailableAction>
  );
}
export function ContactFields({ includeRole = false }: { includeRole?: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Input label="Full name" required maxLength={200} />
      <Input label="Email address" required type="email" maxLength={254} />
      {includeRole ? (
        <Select
          label="Role"
          options={[
            { value: 'STAFF', label: 'Staff' },
            { value: 'ADMIN', label: 'Administrator' },
          ]}
        />
      ) : (
        <>
          <Input label="Phone" type="tel" autoComplete="tel" />
          <Select
            label="Client type"
            options={[
              { value: 'INDIVIDUAL', label: 'Individual' },
              { value: 'BUSINESS', label: 'Business' },
            ]}
          />
        </>
      )}
    </div>
  );
}
export function DetailCard({ title, values }: { title: string; values: Record<string, string> }) {
  return (
    <Card title={title}>
      <dl className="space-y-3">
        {Object.entries(values).map(([label, value]) => (
          <div key={label} className="grid gap-1 sm:grid-cols-2">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="break-words text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
