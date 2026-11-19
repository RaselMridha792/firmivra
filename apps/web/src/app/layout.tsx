import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Nunito_Sans, Playfair_Display, Satisfy } from 'next/font/google';
import { headers } from 'next/headers';
import { ApiProvider } from '../components/api-provider';
import { MockBadge } from '../components/mock-badge';
import { NonceProvider } from '../components/nonce';
import './globals.css';

export const metadata: Metadata = { title: 'Firmivra' };

// Mockup faces, self-hosted at build time; packages/ui maps --font-sans and --font-display to these.
const sans = Nunito_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-face-sans' });
const display = Playfair_Display({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-face-display',
});

// The firm sidebar's slogan, a handwritten script like the dashboard design's.
const script = Satisfy({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-face-script',
});

/**
 * Every page renders per request (reading the request's headers here does that): the proxy puts a
 * fresh CSP nonce on each request (lib/csp.ts), and Next.js stamps it on its own scripts only on
 * a page rendered for that request. A prerendered page carries no nonce, so under the CSP its
 * script tags would be refused (23 firm pages in the Nov 19 sweep). The nonce goes on to client
 * components for an inline script of their own (components/nonce.tsx).
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${script.variable}`}>
      <body className="min-h-screen bg-canvas font-sans text-text antialiased">
        <NonceProvider nonce={nonce}>
          <ApiProvider>{children}</ApiProvider>
        </NonceProvider>
        <MockBadge />
      </body>
    </html>
  );
}
