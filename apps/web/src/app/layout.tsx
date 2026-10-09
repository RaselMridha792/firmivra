import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Nunito_Sans, Playfair_Display } from 'next/font/google';
import { ApiProvider } from '../components/api-provider';
import { MockBadge } from '../components/mock-badge';
import './globals.css';

export const metadata: Metadata = { title: 'Firmivra' };

// Mockup faces, self-hosted at build time; packages/ui maps --font-sans and --font-display to these.
const sans = Nunito_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-face-sans' });
const display = Playfair_Display({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-face-display',
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body className="min-h-screen bg-canvas font-sans text-text antialiased">
        <ApiProvider>{children}</ApiProvider>
        <MockBadge />
      </body>
    </html>
  );
}
