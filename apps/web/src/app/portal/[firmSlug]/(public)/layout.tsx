import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Public portal pages (landing, sign-in, sign-up, Begin Online): the firm's header and footer,
 * no sidebar. The firm's name and the Terms and Privacy links come from R3's public firm info.
 * Nahid builds it from docs/mockups/client-portal/Client portal landing page.png (N01).
 */
export default async function PublicLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ firmSlug: string }>;
}) {
  const { firmSlug } = await params;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface px-6 py-4">
        <Link href={`/${firmSlug}`} className="text-lg font-semibold text-firm-primary">
          Client portal
        </Link>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-6">{children}</main>
      <footer className="flex flex-wrap gap-4 border-t border-border bg-surface px-6 py-4 text-sm text-muted">
        <span>Terms</span>
        <span>Privacy</span>
        <span className="ml-auto">Powered by Firmivra</span>
      </footer>
    </div>
  );
}
