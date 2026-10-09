'use client';

import { Card } from '@firmivra/ui';
import { FileText } from 'lucide-react';
import { useParams } from 'next/navigation';
import { ButtonLink } from '../../../../(public)/_components/button-link';
import { FORMS } from './forms';

/**
 * "Select an Intake Form" (docs/mockups/client-portal/Intake form tab.png, N06): one card per
 * service. Each opens the form's frame; the form itself (autosave, submit, the signature) comes
 * with the portal intake API.
 */
export function IntakeCards() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  return (
    <Card className="grid min-w-0 grid-cols-1 gap-4">
      <header className="flex flex-col gap-4 md:flex-row md:items-start">
        <FileText
          aria-hidden
          className="size-16 shrink-0 rounded-full bg-folder-surface p-4 text-firm-primary"
        />
        <div className="flex-1">
          <h1 className="font-display text-3xl font-bold text-heading">Select an Intake Form</h1>
          <p className="text-text">
            Choose the intake form for the service you need. This helps us gather the information
            needed for providing accurate services and the best possible support.
          </p>
        </div>
      </header>
      <ul aria-label="Intake forms" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {FORMS.map(({ path, title, icon: Icon }) => (
          <li
            key={path}
            className="grid justify-items-center gap-3 rounded-card border border-folder-border p-4 text-center"
          >
            <Icon
              aria-hidden
              className="size-14 rounded-full bg-folder-surface p-3 text-firm-primary"
            />
            <h2 className="font-display text-lg font-bold text-heading">{title}</h2>
            <ButtonLink href={`/${slug}/intake/${path}`} aria-label={`Go to ${title}`}>
              Go to Intake Form
            </ButtonLink>
          </li>
        ))}
      </ul>
    </Card>
  );
}
