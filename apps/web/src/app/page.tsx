// The bare host (for example localhost:3000) has no site of its own: point to the three hosts.
export default function Index() {
  const sites = [
    ['Super Admin console', process.env['ADMIN_BASE_URL'] ?? 'http://admin.localhost:3000'],
    ['Firm workspace', process.env['APP_BASE_URL'] ?? 'http://app.localhost:3000'],
    [
      'Client portal (LVP)',
      `${process.env['PORTAL_BASE_URL'] ?? 'http://portal.localhost:3000'}/lvp`,
    ],
  ] as const;
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-4 text-2xl font-semibold text-brand-900">Firmivra</h1>
      <ul className="flex flex-col gap-2">
        {sites.map(([label, url]) => (
          <li key={url}>
            <a className="text-brand-700 underline" href={url}>
              {label}: {url}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
