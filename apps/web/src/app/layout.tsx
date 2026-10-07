import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ApiProvider } from '../components/api-provider';
import { MockBadge } from '../components/mock-badge';
import './globals.css';

export const metadata: Metadata = { title: 'Firmivra' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas font-sans text-text antialiased">
        <ApiProvider>{children}</ApiProvider>
        <MockBadge />
      </body>
    </html>
  );
}
