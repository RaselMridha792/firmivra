import {
  Bell,
  FacebookLogo,
  InstagramLogo,
  LinkedinLogo,
  YoutubeLogo,
} from '@phosphor-icons/react';
import Image from 'next/image';
import logo from '../../../../../../../../components/app-shell/firmivra-logo.png';
import type { BroadcastReviewFixture } from '../../../../../../../../mocks/admin-communications-review';
import banner from './newsletter-banner.jpg';

interface MessagePreviewProps {
  review: BroadcastReviewFixture | null;
  channel?: string;
  compact?: boolean;
}

export function MessagePreview({
  review,
  channel = 'EMAIL',
  compact = false,
}: MessagePreviewProps) {
  if (!review) {
    return (
      <div className="flex min-h-96 items-center justify-center rounded-control border border-border p-6 text-center text-sm text-muted">
        No message to preview.
      </div>
    );
  }

  const { message } = review;
  if (channel === 'SMS') {
    return (
      <div className="min-h-96 rounded-control border border-border bg-canvas p-5">
        <p className="mb-5 text-center text-sm font-semibold text-heading">Firmivra</p>
        <div className="space-y-3 rounded-xl bg-surface p-4 text-sm text-text shadow-sm">
          <p>{message.greeting}</p>
          <p>{message.body}</p>
          <p>{message.signature}</p>
        </div>
        <p className="mt-3 text-center text-xs text-muted">SMS preview</p>
      </div>
    );
  }

  if (channel === 'IN_APP') {
    return (
      <div className="min-h-96 rounded-control border border-border bg-canvas p-4">
        <div className="flex gap-3 rounded-control border border-border bg-surface p-4">
          <Bell weight="fill" aria-hidden className="size-6 shrink-0 text-action" />
          <div className="min-w-0 space-y-2">
            <p className="text-sm font-bold text-heading">{message.title}</p>
            <p className="text-sm text-muted">{message.body}</p>
            <p className="text-xs font-semibold text-link">{message.action}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-control border border-border bg-surface p-5 text-heading">
      <Image src={logo} alt="Firmivra" className="mx-auto mb-3 h-auto w-28" sizes="112px" />
      <Image
        src={banner}
        alt="A bright office desk with a laptop and plants"
        className="mb-3 h-20 w-full rounded object-cover"
        sizes="(max-width: 1279px) 90vw, 320px"
      />
      <h3 className="mb-3 text-base font-extrabold">{message.title}</h3>
      <div className="space-y-2 text-xs leading-relaxed">
        <p>{message.greeting}</p>
        <p>{message.body}</p>
      </div>
      <div className="my-3 text-center">
        <span className="inline-block rounded bg-action px-5 py-2 text-xs font-semibold text-on-action">
          {message.action}
        </span>
      </div>
      {!compact && (
        <div className="mt-4 border-t border-border pt-4 text-center">
          <div
            className="mb-3 flex justify-center gap-5"
            aria-label="Social media links in email preview"
          >
            {[
              { name: 'Facebook', icon: FacebookLogo },
              { name: 'LinkedIn', icon: LinkedinLogo },
              { name: 'Instagram', icon: InstagramLogo },
              { name: 'YouTube', icon: YoutubeLogo },
            ].map(({ name, icon: SocialIcon }) => (
              <SocialIcon key={name} weight="fill" aria-hidden className="size-4" />
            ))}
          </div>
          <p className="text-xs leading-relaxed">{message.footer}</p>
          <p className="text-xs leading-relaxed">{message.signature}</p>
        </div>
      )}
    </div>
  );
}
