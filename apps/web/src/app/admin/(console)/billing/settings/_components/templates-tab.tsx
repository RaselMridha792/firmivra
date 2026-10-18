'use client';

import { FormField } from '@firmivra/ui';
import { CaretRight } from '@phosphor-icons/react';
import { useState } from 'react';
import {
  TEMPLATE_KINDS,
  type DocumentTemplate,
  type TemplateKind,
} from '../../../../../../mocks/admin-billing';
import { TEMPLATE_BODY_MAX } from '../../../../../../mocks/admin-billing-settings';
import { inputClass } from '../../_components/billing-fields';
import { TEMPLATE_KIND_LABELS } from '../../_components/billing-labels';
import { fillSample, TEMPLATE_PLACEHOLDERS } from './settings-model';
import { SettingsCard, ToggleRow, type SettingsForm } from './settings-parts';

/**
 * Templates (docx §15): the platform's default message for invoices, estimates, receipts, credit
 * notes, payment reminders and refund confirmations, and whether a firm may use its own. Each
 * firm's documents still carry that firm's branding; these are only the default words.
 */

export function TemplatesTab({ form }: { form: SettingsForm | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SettingsCard
        title="Document Templates"
        description="The default email for each billing document. Firms can override one only where it is allowed."
        testId="settings-templates"
      >
        {form ? <TemplateEditor form={form} /> : null}
      </SettingsCard>
    </div>
  );
}

function TemplateEditor({ form }: { form: SettingsForm }) {
  const [kind, setKind] = useState<TemplateKind>('INVOICE');
  const templates = form.value.templates;
  const template = templates[kind];
  const set = (next: Partial<DocumentTemplate>) => {
    const changed: Partial<Record<TemplateKind, DocumentTemplate>> = {};
    changed[kind] = { ...template, ...next };
    form.patch('templates', changed);
  };
  const error = (field: 'name' | 'subject' | 'body') => form.errors[`templates.${kind}.${field}`];
  const label = TEMPLATE_KIND_LABELS[kind];
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <nav aria-label="Templates" className="min-w-0 lg:col-span-4 xl:col-span-3">
        <ul className="flex flex-col gap-1">
          {TEMPLATE_KINDS.map((item) => {
            const on = item === kind;
            const broken = ['name', 'subject', 'body'].some(
              (field) => form.errors[`templates.${item}.${field}`],
            );
            return (
              <li key={item}>
                <button
                  type="button"
                  aria-current={on ? 'true' : undefined}
                  onClick={() => setKind(item)}
                  className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm font-medium ${on ? 'bg-info-soft text-action' : 'text-heading hover:bg-canvas'}`}
                >
                  <span className="flex min-w-0 flex-col">
                    <span>{TEMPLATE_KIND_LABELS[item]}</span>
                    <span className="text-xs font-normal text-muted">
                      {broken
                        ? 'Needs fixing'
                        : templates[item].firmOverride
                          ? 'Firms can override'
                          : 'Platform only'}
                    </span>
                  </span>
                  <CaretRight aria-hidden weight="bold" className="size-4 shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-8 xl:col-span-9">
        <h3 className="text-base font-bold text-heading">{label} Template</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            label="Template Name"
            htmlFor="settings-template-name"
            required
            error={error('name')}
          >
            <input
              id="settings-template-name"
              value={template.name}
              maxLength={60}
              aria-invalid={Boolean(error('name')) || undefined}
              onChange={(event) => set({ name: event.target.value })}
              className={inputClass(Boolean(error('name')))}
            />
          </FormField>
          <FormField
            label="Email Subject"
            htmlFor="settings-template-subject"
            required
            error={error('subject')}
          >
            <input
              id="settings-template-subject"
              value={template.subject}
              maxLength={120}
              aria-invalid={Boolean(error('subject')) || undefined}
              onChange={(event) => set({ subject: event.target.value })}
              className={inputClass(Boolean(error('subject')))}
            />
          </FormField>
        </div>
        <FormField
          label="Message"
          htmlFor="settings-template-body"
          required
          error={error('body')}
          hint={`Placeholders: ${TEMPLATE_PLACEHOLDERS[kind].map((name) => `{${name}}`).join(' ')}`}
          counter={`${template.body.length}/${TEMPLATE_BODY_MAX}`}
        >
          <textarea
            id="settings-template-body"
            rows={6}
            maxLength={TEMPLATE_BODY_MAX}
            value={template.body}
            aria-invalid={Boolean(error('body')) || undefined}
            onChange={(event) => set({ body: event.target.value })}
            className={inputClass(Boolean(error('body')))}
          />
        </FormField>
        <ToggleRow
          label="Firms May Use Their Own Version"
          description="Off: every firm sends this platform default."
          checked={template.firmOverride}
          onChange={(firmOverride) => set({ firmOverride })}
        />
        <section
          aria-label={`${label} preview`}
          data-testid="template-preview"
          className="flex min-w-0 flex-col gap-2 rounded-lg border border-divider bg-subtle p-4"
        >
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">
            Preview with sample values
          </p>
          <p className="font-semibold wrap-anywhere text-heading">{fillSample(template.subject)}</p>
          <p className="text-sm wrap-anywhere whitespace-pre-line text-text">
            {fillSample(template.body)}
          </p>
        </section>
      </div>
    </div>
  );
}
