import { Alert, Card } from '@firmivra/ui';
export default function Page() {
  return (
    <main className="mx-auto max-w-auth space-y-6 p-6">
      <h1 className="text-3xl font-bold text-heading">Create a Business Account</h1>
      <Card>
        <Alert title="Business applications are not available yet">
          Contact Firmivra to request a business workspace.
        </Alert>
        <a href="/" className="mt-6 inline-flex min-h-11 items-center text-link underline">
          ← Back to Firmivra
        </a>
      </Card>
    </main>
  );
}
