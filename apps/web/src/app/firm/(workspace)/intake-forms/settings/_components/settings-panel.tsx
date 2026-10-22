'use client';

import { Button, Drawer } from '@firmivra/ui';
import {
  AutomationFields,
  ClientExperienceFields,
  type FieldsProps,
  GeneralFields,
  type Member,
  NotificationsFields,
  SecurityFields,
  SubmissionRulesFields,
} from './settings-cards';
import type { SectionId } from './settings-model';

/** The categories with an editing panel (Branding edits in Settings; Integrations has a note). */
export type PanelId = Exclude<SectionId, 'branding' | 'integrations'>;

const PANELS: Record<PanelId, { title: string; subtitle: string }> = {
  general: {
    title: 'Edit General Settings',
    subtitle: 'Expiration, save and resume, e-signature, submission IDs and the assigned owner.',
  },
  client: {
    title: 'Edit Client Experience',
    subtitle: 'What clients see while they fill in a form and after they submit it.',
  },
  notifications: {
    title: 'Edit Notifications & Reminders',
    subtitle: 'Who is told when a form is submitted, and when clients are reminded.',
  },
  automation: {
    title: 'Edit Automation Rules',
    subtitle: 'What happens on its own when a form comes in.',
  },
  submission: {
    title: 'Submission Rules',
    subtitle: 'What a client needs before submitting, and what happens after.',
  },
  security: {
    title: 'Edit Security & Compliance',
    subtitle: 'What clients may upload, how large, and the consent they give.',
  },
};

/**
 * A category's editing panel (Octavia's review, I4: Edit "did not open editing"): the same fields
 * as its card, on the same unsaved settings, with room to read them. Save Changes saves every
 * change on the page, as the page's own button does; Cancel puts back what this panel changed.
 */
export function SettingsPanel({
  panel,
  fields,
  members,
  generalOwner,
  followUpOwner,
  dirty,
  busy,
  onSave,
  onCancel,
}: {
  panel: PanelId | null;
  fields: FieldsProps;
  members: Member[];
  generalOwner: Member | null;
  followUpOwner: Member | null;
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const look = panel ? PANELS[panel] : null;
  return (
    <Drawer
      open={panel !== null}
      title={look?.title ?? ''}
      subtitle={look?.subtitle}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {dirty ? 'Cancel' : 'Close'}
          </Button>
          <Button disabled={busy || fields.readOnly || !dirty} onClick={onSave}>
            Save Changes
          </Button>
        </>
      }
    >
      <div
        className="flex flex-col gap-1"
        data-testid={panel ? `settings-panel-${panel}` : undefined}
      >
        {panel === 'general' ? (
          <GeneralFields {...fields} members={members} savedOwner={generalOwner} />
        ) : panel === 'client' ? (
          <ClientExperienceFields {...fields} />
        ) : panel === 'notifications' ? (
          <NotificationsFields {...fields} />
        ) : panel === 'automation' ? (
          <AutomationFields {...fields} members={members} savedOwner={followUpOwner} />
        ) : panel === 'submission' ? (
          <SubmissionRulesFields {...fields} />
        ) : panel === 'security' ? (
          <SecurityFields {...fields} />
        ) : null}
      </div>
    </Drawer>
  );
}
