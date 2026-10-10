import Image from 'next/image';
import firmivraLogo from './firmivra-logo.png';
import firmivraLogoWhite from './firmivra-logo-white.png';

/**
 * The official Firmivra logo (docs/mockups/Firmivra Abstract F Logo.png) with a tagline; `dark`
 * for a navy background, where the wordmark is white.
 */
export function BrandLockup({
  subtitle,
  tone = 'light',
}: {
  subtitle: string;
  tone?: 'light' | 'dark';
}) {
  return (
    <div>
      <Image
        src={tone === 'dark' ? firmivraLogoWhite : firmivraLogo}
        alt="Firmivra"
        preload
        sizes="192px"
        className="block h-auto w-48"
      />
      {/* Under the wordmark, which starts about 53 px into the logo. */}
      <span
        className={`-mt-3 ml-13 block whitespace-nowrap text-xs font-medium uppercase tracking-brand ${tone === 'dark' ? 'text-brand-100' : 'text-muted'}`}
      >
        {subtitle}
      </span>
    </div>
  );
}
