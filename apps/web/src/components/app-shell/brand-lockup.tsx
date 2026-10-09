import Image from 'next/image';
import firmivraLockup from './firmivra-lockup.png';

/** The official Firmivra mark and wordmark with a tagline (sidebar style); `dark` for a navy background. */
export function BrandLockup({
  subtitle,
  tone = 'light',
}: {
  subtitle: string;
  tone?: 'light' | 'dark';
}) {
  return (
    <div>
      <div className="flex items-center">
        <Image
          src={firmivraLockup}
          alt=""
          preload
          sizes="48px"
          className="h-16 w-12 object-contain"
        />
        <span
          className={`ml-1 text-3xl font-semibold leading-none tracking-tight ${tone === 'dark' ? 'text-white' : 'text-heading'}`}
        >
          Firmivra
        </span>
      </div>
      <span
        className={`-mt-3 ml-13 block whitespace-nowrap text-xs font-medium uppercase tracking-brand ${tone === 'dark' ? 'text-brand-100' : 'text-muted'}`}
      >
        {subtitle}
      </span>
    </div>
  );
}
