'use client';

import { Check, CheckCircle, Info, PaperPlaneTilt } from '@phosphor-icons/react';
import { Button, Callout, Card } from '@firmivra/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { api } from '../../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../../lib/query';

const steps = [
  'Review Lead Information',
  'Client Details & Services',
  'Portal & Settings',
  'Review & Confirm',
  'Complete',
];

const afterConversion = [
  'A new client record will be created.',
  'The lead will be marked as Converted.',
  'All selected information will be linked to the client.',
  'The client will appear in the Clients module under the appropriate service tabs.',
  'The original lead record will be stored for reference and linked to the client.',
];

function CompletedStepper() {
  return (
    <>
      <ol aria-label="Conversion progress" className="hidden sm:flex">
        {steps.map((label, index) => (
          <li
            key={label}
            className="relative flex min-w-0 flex-1 flex-col items-center gap-2 text-center"
          >
            {index > 0 ? (
              <span
                aria-hidden="true"
                className="absolute top-4 right-1/2 h-0.5 w-full bg-action"
              />
            ) : null}
            <span className="relative z-10 flex size-8 items-center justify-center rounded-full border-2 border-action bg-action text-on-action">
              <Check aria-hidden weight="bold" className="size-4" />
            </span>
            <span className="text-xs text-muted sm:text-sm">
              {label}
              <span className="sr-only">, completed</span>
            </span>
          </li>
        ))}
      </ol>
      <ol aria-label="Conversion progress" className="flex flex-col gap-2 sm:hidden">
        {steps.map((label) => (
          <li key={label} className="flex items-center gap-3 text-sm text-muted">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-action text-on-action">
              <Check aria-hidden weight="bold" className="size-4" />
            </span>
            {label}
            <span className="sr-only">, completed</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function LinkButton({
  href,
  children,
  variant,
}: {
  href: string;
  children: ReactNode;
  variant: 'primary' | 'secondary';
}) {
  const style =
    variant === 'primary'
      ? 'bg-action text-on-action hover:bg-action-hover'
      : 'border border-border bg-surface text-text hover:bg-subtle';

  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${style}`}
    >
      {children}
    </Link>
  );
}

/** Shows the completed client conversion while keeping its page frames available in every API state. */
export function ConvertLeadCompleteScreen({
  leadId,
  inviteSent,
}: {
  leadId: string;
  inviteSent?: boolean;
}) {
  const profile = useApiQuery(['lead-pipeline', 'profile', leadId], () =>
    api.leadPipeline.profile(leadId),
  );
  const leadName = profile.data
    ? profile.data.client?.name || `${profile.data.firstName} ${profile.data.lastName}`
    : undefined;
  const completed = profile.data?.stage === 'CONVERTED' && profile.data.client !== null;
  const unavailable = profile.isError || (!profile.isPending && !completed);
  const heading = profile.isPending
    ? 'Preparing your client summary'
    : profile.isError
      ? 'Conversion details are unavailable'
      : completed && leadName
        ? `${leadName} is now a client`
        : 'No completed conversion found';

  return (
    <main className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5 p-4 text-text sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted">
            <Link href="/leads" className="text-link hover:underline">
              Leads
            </Link>
            <span aria-hidden="true" className="px-2">
              ›
            </span>
            <span>Convert to Client</span>
          </nav>
          <h1 className="font-serif text-3xl font-bold text-heading sm:text-4xl">
            Convert Lead to Client
          </h1>
          <p className="mt-1 text-sm text-muted sm:text-base">Your lead conversion summary.</p>
        </div>
        <div className="lg:w-1/2 lg:shrink-0">
          <Callout icon={Info} surface="info" iconStyle="tile" size="compact">
            This creates a new client record and links it to the lead. Selected information,
            including communication history, appointments, documents, and notes, is carried over.
          </Callout>
        </div>
      </div>

      <Card className="p-4 sm:p-6">
        <CompletedStepper />
      </Card>

      <section
        className="mx-auto flex w-full max-w-4xl flex-col gap-5"
        aria-label="Conversion result"
      >
        <Card
          data-testid="conversion-result"
          className="flex flex-col items-center gap-4 px-5 py-8 text-center sm:px-8 sm:py-10"
        >
          <span
            className={`flex size-16 items-center justify-center rounded-full sm:size-20 ${completed ? 'bg-success-soft text-success' : 'bg-info-soft text-action'}`}
          >
            {completed ? (
              <CheckCircle aria-hidden weight="fill" className="size-10 sm:size-12" />
            ) : (
              <Info aria-hidden weight="fill" className="size-10 text-action sm:size-12" />
            )}
          </span>
          <div className="flex flex-col gap-2">
            <h2
              data-testid="conversion-title"
              className="font-serif text-2xl font-bold text-heading sm:text-3xl"
            >
              {heading}
            </h2>
            {profile.isPending ? (
              <p role="status" className="text-sm text-muted">
                Loading the converted client details.
              </p>
            ) : unavailable ? (
              <p role="status" className="text-sm text-muted">
                {profile.isError
                  ? 'The client details could not be loaded. You can return to Leads and try again.'
                  : 'This lead does not have a completed client conversion yet.'}
              </p>
            ) : (
              <p className="text-sm text-muted">
                The lead and its selected information are linked to the client record.
              </p>
            )}
          </div>

          {profile.isError ? (
            <Button variant="secondary" onClick={() => void profile.refetch()}>
              Try again
            </Button>
          ) : null}
        </Card>

        <Card data-testid="after-conversion-card" className="border-success-soft">
          <div className="mb-4 flex items-center gap-3">
            <span
              className={`flex size-9 items-center justify-center rounded-control ${completed ? 'bg-success text-on-action' : 'bg-info-soft text-action'}`}
            >
              {completed ? (
                <CheckCircle aria-hidden weight="fill" className="size-5" />
              ) : (
                <Info aria-hidden weight="fill" className="size-5" />
              )}
            </span>
            <h2 className="text-lg font-semibold text-heading">After Conversion</h2>
          </div>
          {completed ? (
            <ul className="flex flex-col gap-3 rounded-control bg-success-soft p-4 text-sm text-text">
              {afterConversion.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <CheckCircle
                    aria-hidden
                    weight="fill"
                    className="mt-0.5 size-4 shrink-0 text-success"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p role="status" className="rounded-control bg-subtle p-4 text-sm text-muted">
              {profile.isPending
                ? 'Conversion details will appear here.'
                : 'After conversion details are not available for this lead.'}
            </p>
          )}
        </Card>

        <Card
          data-testid="conversion-actions"
          className="flex flex-col gap-3 sm:flex-row sm:justify-end"
        >
          {inviteSent === false ? (
            <div className="flex flex-col gap-2 sm:mr-auto sm:max-w-sm">
              <Button variant="secondary" disabled aria-describedby="invite-unavailable">
                <PaperPlaneTilt aria-hidden weight="fill" className="size-4" />
                Send portal invitation
              </Button>
              <p id="invite-unavailable" className="text-xs text-muted">
                Portal invitations cannot be sent from this screen yet.
              </p>
            </div>
          ) : null}
          {profile.data?.client ? (
            <LinkButton
              href={`/clients/${encodeURIComponent(profile.data.client.id)}`}
              variant="primary"
            >
              View Client
            </LinkButton>
          ) : (
            <Button disabled>View Client</Button>
          )}
          <LinkButton href="/leads" variant="secondary">
            Back to Leads
          </LinkButton>
        </Card>
      </section>
    </main>
  );
}
