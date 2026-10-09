'use client';

import { INTAKE_FORMS } from '@firmivra/types';
import { Card, Stepper } from '@firmivra/ui';
import { ArrowLeft, Info } from 'lucide-react';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { FORMS } from './forms';

/**
 * One intake form's frame: its title and steps. The form itself (autosave, submit, "Signed by
 * <name> on <date>", Needs Correction) fills this frame once the portal intake API, Arfan's
 * form blocks and the agreements contract are on main.
 */
export function IntakeFrame() {
  const { firmSlug: slug, form } = useParams<{ firmSlug: string; form: string }>();
  const entry = FORMS.find((f) => f.path === form);
  if (!entry) notFound();
  const definition = INTAKE_FORMS[entry.key];
  return (
    <Card className="grid min-w-0 grid-cols-1 gap-4">
      <Link href={`/${slug}/intake`} className="inline-flex items-center gap-2 text-link underline">
        <ArrowLeft aria-hidden className="size-4" /> All intake forms
      </Link>
      <h1 className="font-display text-3xl font-bold text-heading">
        {definition?.title ?? entry.title}
      </h1>
      {definition?.subtitle ? <p className="text-text">{definition.subtitle}</p> : null}
      {definition ? (
        <div className="min-w-0 overflow-x-auto">
          <Stepper
            steps={definition.steps.map((s) => ({ id: s.key, label: s.title }))}
            current={definition.steps[0]?.key ?? ''}
            label="Form steps"
          />
        </div>
      ) : null}
      <p role="status" className="flex gap-2 rounded-card bg-folder-surface p-3 text-sm text-text">
        <Info aria-hidden className="size-5 shrink-0 text-firm-primary" />
        This form isn&apos;t open for you yet. Your firm will send it when your service starts, or
        send us a message to ask for it.
      </p>
    </Card>
  );
}
