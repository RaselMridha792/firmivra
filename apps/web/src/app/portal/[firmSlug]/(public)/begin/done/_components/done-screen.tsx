'use client';

import { BEGIN_ONLINE_SERVICES, beginOnlineFormOfPath } from '@firmivra/types';
import { PageContainer } from '@firmivra/ui';
import {
  ArrowRight,
  CalendarDays,
  Check,
  CircleCheck,
  FileSearch,
  Handshake,
  Mail,
  PhoneCall,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { usePortal } from '../../../../layout';

function Tile({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col items-center gap-1 px-3 text-center">
      <span
        aria-hidden="true"
        className="mb-1 grid size-14 place-items-center rounded-full bg-folder-surface text-heading"
      >
        {icon}
      </span>
      <h3 className="font-display text-lg font-bold text-heading">{title}</h3>
      <p className="text-sm">{children}</p>
    </li>
  );
}

/**
 * The page after a Begin Online submit (/{firm}/begin/done?form={path}): "Success Tax Prep.png"
 * after the annual tax form, "Success Page for all services except taxes.png" after the others
 * (and when the form is unknown). It never moves on by itself; nothing about the submission is
 * read here.
 */
export function DoneScreen({ firmSlug, formPath }: { firmSlug: string; formPath: string }) {
  const { business } = usePortal();
  const form = beginOnlineFormOfPath(formPath);
  const tax = form !== null && BEGIN_ONLINE_SERVICES[form].success === 'TAX';
  return (
    <div
      data-theme="begin-online"
      data-testid="begin-done"
      className="bg-surface py-8 text-firm-primary"
    >
      <PageContainer className="flex flex-col items-center text-center">
        <span
          aria-hidden="true"
          className="grid size-24 place-items-center rounded-full bg-navigation text-on-action"
        >
          <Check className="size-14" strokeWidth={3} />
        </span>
        <h1 className="mt-3 font-display text-5xl font-bold text-heading sm:text-6xl">Success!</h1>
        <span aria-hidden="true" className="mt-1 h-1 w-40 rounded-full bg-action" />
        <h2 className="mt-3 font-display text-2xl font-bold text-heading sm:text-3xl">
          Your Form Has Been Successfully Submitted!
        </h2>
        <p className="mt-2 max-w-2xl text-base">
          {tax ? (
            <>
              Congratulations on taking this important step toward financial clarity and peace of
              mind. We&apos;re excited to support you with your tax preparation needs!
            </>
          ) : (
            <>
              Thank you for taking this important step toward your goals. We appreciate your trust
              in {business.name} and look forward to supporting you.
            </>
          )}
        </p>

        {tax ? (
          <section
            aria-labelledby="next-heading"
            className="mt-5 grid w-full max-w-4xl items-center gap-4 rounded-card bg-folder-surface p-5 text-left sm:grid-cols-4"
          >
            <span
              aria-hidden="true"
              className="mx-auto grid size-24 place-items-center rounded-full bg-surface text-heading"
            >
              <UsersRound className="size-12" />
            </span>
            <div className="sm:col-span-3">
              <h2 id="next-heading" className="font-display text-2xl font-bold text-heading">
                What Happens Next?
              </h2>
              <p className="mt-1 text-sm">
                A member of our team will review your information and reach out to you soon to
                schedule your next steps, which may include:
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {[
                  'A free initial tax consultation',
                  'Completing your tax preparation',
                  'Or to gather additional information if needed',
                ].map((line) => (
                  <li key={line} className="flex items-center gap-2">
                    <CircleCheck aria-hidden="true" className="size-5 shrink-0 text-accent" />
                    {line}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm">
                We look forward to helping you maximize your refund and stay tax ready!
              </p>
            </div>
          </section>
        ) : (
          <section aria-labelledby="next-heading" className="mt-5 w-full max-w-4xl">
            <h2 id="next-heading" className="font-display text-2xl font-bold text-heading">
              What Happens Next?
            </h2>
            <ol className="mt-3 grid gap-4 rounded-card border border-folder-border p-4 sm:grid-cols-3">
              {[
                {
                  icon: <FileSearch className="size-10" />,
                  title: "We'll Review Your Information",
                  text: 'Our team will carefully review your submission to ensure we have everything needed.',
                },
                {
                  icon: <PhoneCall className="size-10" />,
                  title: 'Your Assigned Specialist Will Reach Out',
                  text: 'A member of our team will contact you soon to discuss your needs and next steps.',
                },
                {
                  icon: <UsersRound className="size-10" />,
                  title: "Let's Move Forward Together",
                  text: "We'll guide you through the process and help you take the next steps toward achieving your goals.",
                },
              ].map((item, index) => (
                <li key={item.title} className="flex flex-col items-center gap-1 text-center">
                  <span
                    className={`grid size-9 place-items-center rounded-full text-lg font-bold text-on-action ${index % 2 ? 'bg-navigation' : 'bg-action'}`}
                  >
                    {index + 1}
                  </span>
                  <span aria-hidden="true" className="text-heading">
                    {item.icon}
                  </span>
                  <h3 className="font-display text-lg font-bold text-heading">{item.title}</h3>
                  <p className="text-sm">{item.text}</p>
                </li>
              ))}
            </ol>
          </section>
        )}

        <ul className="mt-5 grid w-full max-w-4xl gap-4 rounded-card bg-folder-surface py-4 sm:grid-cols-3">
          <Tile
            icon={<Mail className="size-7" />}
            title={tax ? 'Keep an Eye on Your Inbox' : 'Check Your Inbox'}
          >
            You&apos;ll receive a confirmation email with a copy of your submission.
          </Tile>
          <Tile
            icon={<PhoneCall className="size-7" />}
            title={tax ? 'Questions in the Meantime?' : 'Need Assistance?'}
          >
            If you have any questions, feel free to reach out. We&apos;re here to help!
          </Tile>
          <Tile icon={<Handshake className="size-7" />} title="Thank You!">
            We appreciate your trust in {business.name}.
          </Tile>
        </ul>

        <div className="mt-5 flex flex-col items-center gap-1">
          <Link
            href={`/${firmSlug}/appointments`}
            className="inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-4 py-2 text-sm font-semibold text-on-action hover:bg-action-hover"
          >
            <CalendarDays aria-hidden="true" className="size-5" />
            Schedule an Appointment
            <ArrowRight aria-hidden="true" className="size-5" />
          </Link>
          <Link href={`/${firmSlug}/begin`} className="text-sm underline">
            Back to Begin Online
          </Link>
        </div>

        <p className="mt-6 font-display text-2xl italic text-heading">
          {tax
            ? 'Your Goals. Our Expertise. A Brighter Tomorrow.'
            : 'Small Business. Big Possibilities.'}
        </p>
        <p className="mt-1 text-xs font-semibold tracking-eyebrow uppercase">
          {tax ? 'Plan | Prepare | Prosper' : 'People | Purpose | Prosperity'}
        </p>
      </PageContainer>
    </div>
  );
}
