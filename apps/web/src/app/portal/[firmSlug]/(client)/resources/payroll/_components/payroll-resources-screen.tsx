'use client';

import type { MyContentItem } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowRight,
  ChartNoAxesCombined,
  CheckCircle2,
  Clock3,
  FileText,
  Folder,
  Handshake,
  Lightbulb,
  Megaphone,
  Settings,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { BusinessOnly, isBusinessOnly } from '../../_components/business-only';
import {
  compliance,
  deadlines,
  forms,
  practices,
  records,
  reminders,
  setupSteps,
} from './payroll-data';

function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 grid gap-2 text-sm text-text">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-firm-text" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function PanelHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header>
      <h2 className="font-display text-xl font-bold text-heading">{title}</h2>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
    </header>
  );
}

function PayrollDashboard({ items, slug }: { items: MyContentItem[]; slug: string }) {
  const setupResource =
    items.find((item) => item.title.toLowerCase().includes('setup')) ?? items[0];
  const publishedSteps = setupResource?.body
    ?.split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').trim())
    .filter(Boolean);
  const stepsToShow = publishedSteps?.length
    ? publishedSteps.map((title, index) => ({
        icon: setupSteps[index]?.icon ?? FileText,
        title,
        detail: setupSteps[index]?.detail,
      }))
    : setupSteps;
  const additionalResources = items.filter((item) => item.id !== setupResource?.id);

  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <header className="min-w-0">
          <Link
            href={`/${slug}/business`}
            className="inline-flex items-center gap-2 text-sm font-medium text-firm-text hover:underline"
          >
            <ArrowLeft aria-hidden className="size-4" /> Back to Resources
          </Link>
          <h1 className="mt-1 font-display text-4xl leading-tight font-bold text-heading md:text-5xl">
            Payroll <span className="text-firm-text">Resources</span>
          </h1>
          <h2 className="text-lg font-bold text-heading md:text-xl">
            Set up. Stay Compliant. Pay with Confidence.
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-relaxed text-text">
            Whether you have employees or independent contractors, proper payroll management is
            essential to keep your business compliant and your team paid on time. Explore the
            resources below to help you set up payroll, understand your responsibilities, and stay
            up to date with requirements.
          </p>
        </header>

        <Card className="grid content-start gap-2 border-folder-border! bg-folder-surface! p-4!">
          <div className="flex items-start gap-3">
            <Lightbulb aria-hidden className="size-8 shrink-0 text-firm-text" />
            <div>
              <h2 className="font-display text-lg font-bold text-heading">
                Need Professional Help?
              </h2>
              <p className="mt-1 text-sm text-text">
                Our team can help you set up payroll, choose the right solution, and stay compliant
                with federal and state requirements.
              </p>
            </div>
          </div>
          <Link
            href={`/${slug}/appointments`}
            className="mt-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-firm-button px-4 py-2 text-sm font-semibold text-on-firm-button hover:bg-firm-button-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-firm-primary"
          >
            Schedule an Appointment <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Card>
      </div>

      <div className="grid min-w-0 gap-3 md:grid-cols-3">
        <FeatureCard
          icon={Settings}
          title="Payroll Setup Guide"
          description="Step-by-step instructions to get started."
        />
        <FeatureCard
          icon={FileText}
          title="Payroll Forms"
          description="Common forms you'll need for employees and contractors."
        />
        <FeatureCard
          icon={ShieldCheck}
          title="Compliance Checklist"
          description="Stay on track with federal and state requirements."
        />
      </div>

      <Card className="grid min-w-0 gap-3 p-4!">
        <PanelHeading
          title={setupResource?.title ?? 'Payroll Setup Steps'}
          subtitle={
            setupResource?.description ??
            'Follow these key steps to set up payroll for your business.'
          }
        />
        <ol className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {stepsToShow.map(({ icon: Icon, title, detail }, index) => (
            <li
              key={title}
              className="relative grid content-start gap-2 rounded-card border border-folder-border bg-folder-surface p-3 pt-9"
            >
              <span className="absolute top-2 left-2 grid size-7 place-items-center rounded-full bg-firm-primary text-sm font-bold text-on-action">
                {index + 1}
              </span>
              <Icon aria-hidden className="mx-auto size-7 text-firm-text" />
              <h3 className="text-center text-base leading-tight font-bold text-heading">
                {title}
              </h3>
              {Array.isArray(detail) ? (
                <ul className="grid gap-1 text-xs text-text">
                  {detail.map((line) => (
                    <li key={line} className="flex items-start gap-1.5">
                      <span
                        aria-hidden
                        className="mt-1 size-1.5 shrink-0 rounded-full bg-firm-primary"
                      />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              ) : detail ? (
                <p className="text-xs text-muted">{detail}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid min-w-0 gap-3 lg:grid-cols-3">
        <Card className="min-w-0 p-4!">
          <PanelHeading
            title="Payroll Compliance Requirements"
            subtitle="As an employer, you're responsible for the following:"
          />
          <CheckList items={compliance} />
        </Card>
        <Card className="min-w-0 p-4!">
          <PanelHeading
            title="Common Payroll Forms"
            subtitle="These are the forms you'll typically use:"
          />
          <ul className="mt-3 grid gap-2">
            {forms.map(([name, description]) => (
              <li key={name} className="flex items-start gap-2 text-sm">
                <FileText aria-hidden className="mt-0.5 size-5 shrink-0 text-firm-text" />
                <span>
                  <strong className="text-heading">{name}</strong>
                  <span className="block text-muted">{description}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="min-w-0 p-4!">
          <PanelHeading
            title="Payroll Best Practices"
            subtitle="Tips to keep your payroll running smoothly:"
          />
          <CheckList items={practices} />
        </Card>
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-3">
        <Card className="min-w-0 p-4! lg:col-span-2">
          <PanelHeading
            title="Employee vs. Contractor"
            subtitle="Understand the difference to stay compliant."
          />
          <div className="mt-3 grid gap-4 md:grid-cols-2 md:divide-x md:divide-folder-border">
            <WorkerType
              icon={UsersRound}
              title="Employees"
              items={[
                'You control how, when, and where they work',
                'You withhold taxes (federal, state, FICA)',
                'You provide a W-2',
                'May be eligible for benefits',
                'Covered by labor laws',
              ]}
            />
            <WorkerType
              icon={Handshake}
              title="Independent Contractors"
              items={[
                'They control how and when they work',
                'You do not withhold taxes',
                'You provide a 1099-NEC (if paid $600+ in a year)',
                'Not eligible for employee benefits',
                'Not covered by most labor laws',
              ]}
            />
          </div>
        </Card>
        <Card className="min-w-0 p-4!">
          <div className="flex items-start gap-3">
            <Clock3 aria-hidden className="size-7 shrink-0 text-firm-text" />
            <div className="min-w-0">
              <PanelHeading
                title="Important Deadlines"
                subtitle="Keep these dates on your calendar:"
              />
              <ul className="mt-3 grid gap-2 text-sm">
                {deadlines.map(([name, detail]) => (
                  <li
                    key={name}
                    className="relative pl-3 before:absolute before:top-2 before:left-0 before:size-1.5 before:rounded-full before:bg-firm-primary"
                  >
                    <strong className="block text-heading">{name}</strong>
                    <span className="text-muted">{detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-3">
        <Card className="min-w-0 p-4!">
          <div className="flex items-start gap-3">
            <Folder aria-hidden className="size-7 shrink-0 text-firm-text" />
            <div className="min-w-0">
              <PanelHeading
                title="Stay Organized with Recordkeeping"
                subtitle="Keep the following payroll records for at least 4 years:"
              />
              <CheckList items={records} />
            </div>
          </div>
        </Card>
        <Card className="min-w-0 p-4!">
          <div className="flex items-start gap-3">
            <Megaphone aria-hidden className="size-7 shrink-0 text-firm-text" />
            <div className="min-w-0">
              <PanelHeading title="Key Reminders" subtitle="A few things to keep in mind:" />
              <CheckList items={reminders} />
            </div>
          </div>
        </Card>
        <Card className="grid content-start gap-3 border-folder-border! bg-folder-surface! p-4!">
          <ChartNoAxesCombined aria-hidden className="size-8 text-firm-text" />
          <h2 className="font-display text-xl font-bold text-heading">
            Grow Your Business with Confidence
          </h2>
          <p className="text-sm text-text">
            Let us handle the payroll details so you can focus on what you do best.
          </p>
          <Link
            href={`/${slug}/appointments`}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-firm-button px-4 py-2 text-sm font-semibold text-on-firm-button hover:bg-firm-button-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-firm-primary"
          >
            Schedule an Appointment <ArrowRight aria-hidden className="size-4" />
          </Link>
          <p className="text-right font-display text-lg font-semibold italic text-firm-text">
            Plan | Prepare | Prosper
          </p>
        </Card>
      </div>

      {additionalResources.length > 0 ? (
        <section className="grid gap-3" aria-label="Additional payroll resources">
          <h2 className="font-display text-xl font-bold text-heading">More Payroll Resources</h2>
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            {additionalResources.map((item) => (
              <Card key={item.id} className="min-w-0 p-4!">
                <h3 className="font-display text-lg font-bold text-heading">{item.title}</h3>
                {item.description ? (
                  <p className="mt-1 text-sm text-muted">{item.description}</p>
                ) : null}
                {item.body ? (
                  <p className="mt-3 text-sm whitespace-pre-wrap text-text">{item.body}</p>
                ) : null}
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Card className="flex min-w-0 items-center gap-3 border-folder-border! p-3!">
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-folder-surface text-firm-text">
        <Icon aria-hidden className="size-7" />
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block font-display text-lg leading-tight text-heading">{title}</strong>
        <span className="mt-1 block text-sm text-muted">{description}</span>
      </span>
      <ArrowRight aria-hidden className="size-5 shrink-0 text-firm-text" />
    </Card>
  );
}

function WorkerType({
  icon: Icon,
  title,
  items,
}: {
  icon: LucideIcon;
  title: string;
  items: string[];
}) {
  return (
    <section className="min-w-0 md:px-3 first:md:pl-0 last:md:pr-0">
      <h3 className="flex items-center gap-2 font-display text-lg font-bold text-heading">
        <Icon aria-hidden className="size-6 shrink-0 text-firm-text" /> {title}
      </h3>
      <ul className="mt-2 grid gap-1.5 text-sm text-text">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-firm-primary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PayrollResourcesScreen() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const content = useApiQuery(['my-content', slug, 'RESOURCE', 'payroll'], () =>
    api.myContent(slug).list({ kind: 'RESOURCE', category: 'payroll' }),
  );

  if (isBusinessOnly(content.error)) return <BusinessOnly slug={slug} />;

  return (
    <PageState query={content} empty="Your firm hasn't added any payroll resources yet.">
      {(items) => <PayrollDashboard items={items} slug={slug} />}
    </PageState>
  );
}
