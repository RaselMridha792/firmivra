'use client';

import { EnvelopeSimple, Key, SignIn, UsersThree } from '@phosphor-icons/react';
import { useFirm } from '../../../../../components/firm-context';

const button =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-5 text-sm font-semibold';

/**
 * What an applicant who may already have an account is offered (Octavia's spec, section 9): only
 * Sign In, Reset Password and Contact Firm, on the firm's own client portal. Each opens that public
 * page in a new tab, so the preview signs in, resets and sends nothing; no staff control is here.
 */
export function ClientViewPreview({ portalBase }: { portalBase: string }) {
  const { firm } = useFirm();
  const portal = `${portalBase.replace(/\/+$/, '')}/${firm.slug}`;
  const links = [
    { label: 'Sign In', href: `${portal}/sign-in`, icon: SignIn, primary: true },
    { label: 'Reset Password', href: `${portal}/forgot-password`, icon: Key, primary: false },
    // The portal's pages show the firm's phone, email and hours.
    { label: 'Contact Firm', href: portal, icon: EnvelopeSimple, primary: false },
  ];
  return (
    <section
      aria-labelledby="su-preview"
      data-testid="client-view-preview"
      className="min-w-0 rounded-xl border border-divider bg-info-soft p-5"
    >
      <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-action uppercase">
        <UsersThree aria-hidden weight="fill" className="size-5" />
        Client view preview
      </p>
      <h2 id="su-preview" className="mt-2 font-display text-xl font-bold text-heading">
        Already have an account?
      </h2>
      <p className="mt-1 text-sm text-text">
        Sign in or reset your password. If you need help, contact your firm.
      </p>
      <ul className="mt-4 flex flex-wrap gap-3">
        {links.map((l) => (
          <li key={l.label}>
            <a
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`${button} ${l.primary ? 'bg-action text-on-action hover:bg-action-hover' : 'border border-action bg-surface text-action hover:bg-accent-soft'}`}
            >
              <l.icon aria-hidden weight="bold" className="size-5" />
              {l.label}
              <span className="sr-only"> (opens your client portal in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
