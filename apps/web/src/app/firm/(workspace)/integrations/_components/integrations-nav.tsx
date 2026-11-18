import type { IntegrationEnvironment } from '@firmivra/types';
import Link from 'next/link';

// I-UA02 (Integrations Review Two): three places, one way between them: browse the tools, manage
// your connections, and follow your requests. Live or Test goes along to each.

export type IntegrationsPlace = 'browse' | 'connections' | 'requests';

const PLACES: { place: IntegrationsPlace; label: string; path: string; tab?: string }[] = [
  { place: 'browse', label: 'Browse integrations', path: '/integrations/marketplace' },
  { place: 'connections', label: 'My connections', path: '/integrations', tab: 'connected' },
  { place: 'requests', label: 'My requests', path: '/integrations/requests' },
];

/** `path` with the tab and, in Test, the environment. */
export function placeHref(path: string, environment: IntegrationEnvironment, tab?: string) {
  const q = new URLSearchParams();
  if (tab) q.set('tab', tab);
  if (environment === 'TEST') q.set('environment', 'TEST');
  const query = q.toString();
  return query ? `${path}?${query}` : path;
}

export function IntegrationsNav({
  current,
  environment,
}: {
  current: IntegrationsPlace;
  environment: IntegrationEnvironment;
}) {
  return (
    <nav aria-label="Integrations" data-testid="integrations-nav">
      <ul className="flex flex-wrap gap-2">
        {PLACES.map(({ place, label, path, tab }) => (
          <li key={place}>
            <Link
              href={placeHref(path, environment, tab)}
              aria-current={place === current ? 'page' : undefined}
              className={`inline-flex min-h-9 items-center rounded-control border px-3 text-sm font-semibold ${
                place === current
                  ? 'border-action bg-action text-on-action'
                  : 'border-border bg-surface text-heading hover:bg-accent-soft'
              }`}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
