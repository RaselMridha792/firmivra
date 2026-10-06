import { Brand, Card } from '@firmivra/ui';
export function FirmLanding() {
  return (
    <main className="mx-auto flex min-h-screen max-w-public flex-col justify-center gap-8 p-6">
      <Brand />
      <div>
        <h1 className="text-3xl font-bold text-heading">Welcome to Firmivra</h1>
        <p className="mt-3 text-muted">Choose how you would like to access your workspace.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {[
          {
            title: 'Welcome Back',
            description: 'Sign in to manage your clients and work.',
            href: '/sign-in',
            action: 'Sign in',
          },
          {
            title: 'Create a Business Account',
            description: 'Apply for a new firm workspace.',
            href: '/create-account',
            action: 'Create account',
          },
          {
            title: 'Sign In for the First Time',
            description: 'Use your invitation to activate your account.',
            href: '/activate',
            action: 'Activate account',
          },
        ].map((item) => (
          <Card key={item.href} title={item.title}>
            <p className="mb-6 text-sm text-muted">{item.description}</p>
            <a
              href={item.href}
              className="inline-flex min-h-11 items-center rounded-control bg-action px-4 py-2 text-sm font-semibold text-on-action"
            >
              {item.action} →
            </a>
          </Card>
        ))}
      </div>
    </main>
  );
}
