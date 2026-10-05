import { ComingSoon } from '@firmivra/ui';

export default function HomePage() {
  return (
    <ComingSoon
      brand="Firmivra"
      description="One place for your team, your client work, and a portal that feels like your business. A more connected way to work is on the way."
      beta={{ business: 'LVP Accounting & Taxes', date: 'January 8, 2027', dateTime: '2027-01-08' }}
      experiences={[
        {
          name: 'Firm Workspace',
          summary: 'Team, clients & services',
          description:
            'Bring your team, client records, documents and day-to-day work together in one workspace.',
          icon: 'workspace',
        },
        {
          name: 'Client Portal',
          summary: 'Documents & conversations',
          description:
            'Give clients a branded space for intake, documents, messages, invoices and appointments.',
          icon: 'portal',
        },
        {
          name: 'Platform Oversight',
          summary: 'Applications & access',
          description:
            'A separate space for Firmivra to review firm applications and manage platform access.',
          icon: 'oversight',
        },
      ]}
    />
  );
}
