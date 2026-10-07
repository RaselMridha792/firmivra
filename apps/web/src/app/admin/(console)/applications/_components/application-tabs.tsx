import type { FirmApplication } from './application-data';

export type ApplicationTab = 'all' | 'pending' | 'approved' | 'declined';

const tabs: { id: ApplicationTab; label: string }[] = [
  { id: 'all', label: 'All Applications' },
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'declined', label: 'Declined' },
];

export function matchesTab(application: FirmApplication, tab: ApplicationTab) {
  if (tab === 'all') return true;
  if (tab === 'pending')
    return (
      application.status === 'Pending Review' || application.status === 'Information Requested'
    );
  return application.status.toLowerCase() === tab;
}

export function ApplicationTabs({
  applications,
  selected,
  onSelect,
}: {
  applications: FirmApplication[];
  selected: ApplicationTab;
  onSelect: (tab: ApplicationTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Filter applications by status"
      className="flex gap-5 overflow-x-auto border-b border-border px-5"
    >
      {tabs.map((tab) => {
        const count = applications.filter((application) => matchesTab(application, tab.id)).length;
        return (
          <button
            key={tab.id}
            id={`application-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={selected === tab.id}
            onClick={() => onSelect(tab.id)}
            className={`shrink-0 border-b-2 px-1 py-4 text-sm ${selected === tab.id ? 'border-brand-700 font-semibold text-brand-700' : 'border-transparent text-muted hover:text-text'}`}
          >
            {tab.label} ({count})
          </button>
        );
      })}
    </div>
  );
}
