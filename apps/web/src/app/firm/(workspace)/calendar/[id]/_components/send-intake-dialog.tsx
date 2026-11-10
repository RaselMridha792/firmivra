'use client';

import type { AppointmentRecord, FormDeliveryChannel } from '@firmivra/types';
import { Button, Input, Modal, Select, Textarea } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { SCHEDULING } from '../../_components/appointments-parts';

// Octavia's A9: the service intake for this appointment, sent from it. The appointment's type
// names the form it asks for (Appointment Types > Required intake form); the intake is the
// client's and is linked to this appointment, which then shows whether it was completed. It is
// sent when a member sends it, never on its own.

const SEND_ERRORS: Record<string, string> = {
  FORM_ALREADY_OPEN: 'This client already has this form open. Resend it from Intake Forms instead.',
  PORTAL_UNAVAILABLE: 'This client has no portal access yet: choose Email.',
  APPOINTMENT_MISMATCH: "This appointment is not this client's, or it is cancelled.",
  FORM_NOT_PUBLISHED: 'Publish this form before sending it.',
};

export function SendIntakeDialog({
  record: r,
  requiredFormId,
  onClose,
  onSent,
}: {
  record: AppointmentRecord;
  requiredFormId: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const forms = useApiQuery(['intake-forms', 'published', 'for-appointment'], () =>
    api.intakeForms.forms({ templates: 'all', status: 'PUBLISHED' }),
  );
  const [formId, setFormId] = useState(requiredFormId ?? '');
  const [channel, setChannel] = useState<FormDeliveryChannel>('EMAIL');
  const day = new Date(r.startsAt).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const formName = forms.data?.find((f) => f.id === formId)?.name ?? 'the intake form';
  const [subject, setSubject] = useState<string>();
  const [message, setMessage] = useState<string>();
  // One key per dialog: a retried send returns the first one, never a second form.
  const [key] = useState(() => crypto.randomUUID());
  const send = useApiMutation(
    () =>
      api.intakeForms.send({
        idempotencyKey: key,
        recipient: { kind: 'CLIENT', id: r.contact.id! },
        formId,
        channel,
        subject: subject ?? `Please complete ${formName} before your appointment`,
        message:
          message ??
          `Please complete ${formName} before your appointment on ${day}. It helps us prepare.`,
        appointmentId: r.id,
        allowSaveAndContinue: true,
        sendMeCopy: false,
      }),
    { invalidate: SCHEDULING },
  );
  return (
    <Modal
      open
      title="Send Intake Form"
      subtitle={`${r.contact.name} · ${day}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!formId || send.isPending}
            onClick={() => send.mutate(undefined, { onSuccess: onSent })}
          >
            {send.isPending ? 'Sending…' : 'Send Form'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="send-intake-dialog">
        <p className="text-sm text-text">
          The client gets the form now; this appointment then shows whether they completed it.
        </p>
        <Select
          label="Form"
          value={formId}
          onChange={(e) => setFormId(e.target.value)}
          options={[
            { value: '', label: forms.isPending ? 'Loading forms…' : 'Choose a form' },
            ...(forms.data ?? []).map((f) => ({
              value: f.id,
              label: f.id === requiredFormId ? `${f.name} (this type's form)` : f.name,
            })),
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
          value={subject ?? `Please complete ${formName} before your appointment`}
          onChange={(e) => setSubject(e.target.value)}
        />
        <Textarea
          label="Message"
          rows={3}
          maxLength={500}
          value={
            message ??
            `Please complete ${formName} before your appointment on ${day}. It helps us prepare.`
          }
          onChange={(e) => setMessage(e.target.value)}
        />
        {send.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(send.error, SEND_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
