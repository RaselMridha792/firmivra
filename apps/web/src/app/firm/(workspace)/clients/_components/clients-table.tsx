'use client';

import type { ClientListRow } from '@firmivra/types';
import {
  ActionMenu,
  Avatar,
  Badge,
  IconButton,
  Pagination,
  Table,
  type ActionMenuSection,
  type Column,
} from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  Archive,
  ChatCircle,
  DotsThreeVertical,
  EnvelopeSimple,
  Eye,
  FileText,
  Receipt,
  Signature,
  User,
} from '@phosphor-icons/react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ACCOUNT_TYPES, dateText, formatPhone } from './client-parts';
import { activityText, money, PAGE_SIZES, shortName, STAGES, timeText } from './list-parts';

export type RowAction = 'ARCHIVE' | 'RESTORE';

function NameCell({ client }: { client: ClientListRow }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={client.displayName} size="lg" />
      <span className="flex min-w-0 flex-col leading-tight">
        <Link
          href={`/clients/${client.id}`}
          data-testid="client-link"
          title={client.displayName}
          className="truncate text-xs leading-tight font-semibold text-heading hover:underline"
        >
          {client.displayName}
        </Link>
        {client.email ? (
          <span className="truncate text-xs leading-tight text-muted" title={client.email}>
            {client.email}
          </span>
        ) : null}
        {client.phone ? (
          <span className="truncate text-xs leading-tight text-muted">
            {formatPhone(client.phone)}
          </span>
        ) : null}
      </span>
    </span>
  );
}

function TypeBadge({ client }: { client: ClientListRow }) {
  return (
    <span className="[&>span]:!rounded-md [&>span]:!px-2 [&>span]:!py-0.5 [&>span]:!leading-4 [&>span]:!font-medium">
      <Badge tone={client.accountType === 'BUSINESS' ? 'purple' : 'neutral'}>
        {ACCOUNT_TYPES[client.accountType]}
      </Badge>
    </span>
  );
}

function Services({ client }: { client: ClientListRow }) {
  if (!client.services.length) return <span className="text-muted">—</span>;
  return (
    <span className="flex min-w-0 flex-col items-start gap-1 [&>span]:!max-w-full [&>span]:!rounded-md [&>span]:!px-2 [&>span]:!py-0.5 [&>span]:!leading-4 [&>span]:!font-medium">
      {client.services.map((service) => (
        <Badge key={service.id} tone="info">
          {service.name}
        </Badge>
      ))}
    </span>
  );
}

function StageBadge({ client }: { client: ClientListRow }) {
  const stage = STAGES[client.status];
  return (
    <span className="flex flex-wrap gap-1 [&>span]:!gap-1 [&>span]:!px-2 [&>span]:!font-medium [&>span]:whitespace-nowrap">
      <Badge tone={stage.tone} dot>
        {stage.label}
      </Badge>
      {client.archivedAt ? <Badge>Archived</Badge> : null}
    </span>
  );
}

function MissingDocs({ client }: { client: ClientListRow }) {
  const count = client.missingDocuments;
  const circle = `inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold ${count ? 'bg-danger-soft text-danger' : 'bg-table-head text-text'}`;
  return count ? (
    <Link
      href={`/clients/${client.id}/documents`}
      aria-label={`${count} missing ${count === 1 ? 'document' : 'documents'}: open documents`}
      className={`${circle} hover:underline`}
    >
      {count}
    </Link>
  ) : (
    <span aria-label="No missing documents" className={circle}>
      0
    </span>
  );
}

function Balance({ client }: { client: ClientListRow }) {
  const owes = client.balanceDueCents > 0;
  return owes ? (
    <Link
      href={`/clients/${client.id}/invoices`}
      className="text-xs font-semibold whitespace-nowrap text-danger hover:underline"
    >
      {money(client.balanceDueCents)}
    </Link>
  ) : (
    <span className="text-xs font-medium whitespace-nowrap text-heading">{money(0)}</span>
  );
}

function LastActivity({ at }: { at: string | null }) {
  if (!at) return <span className="text-muted">—</span>;
  const { day, time } = activityText(at);
  return (
    <time dateTime={at} className="flex flex-col leading-tight text-muted">
      <span>{day}</span>
      {time ? <span>{time}</span> : null}
    </time>
  );
}

function NextAppointment({ at }: { at: string | null }) {
  if (!at) {
    return (
      <span className="whitespace-nowrap [&>span]:!rounded-md [&>span]:!px-2 [&>span]:!py-0.5 [&>span]:!leading-4 [&>span]:!font-medium">
        <Badge>Not Scheduled</Badge>
      </span>
    );
  }
  return (
    <time dateTime={at} className="flex flex-col leading-tight whitespace-nowrap text-text">
      <span>{dateText(at)}</span>
      <span>{timeText(at)}</span>
    </time>
  );
}

function Assigned({ client }: { client: ClientListRow }) {
  if (!client.assignedTo) {
    return (
      <span className="flex min-w-0 items-center gap-2 text-text">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-disabled text-muted">
          <User aria-hidden weight="fill" className="size-5" />
        </span>
        Unassigned
      </span>
    );
  }
  const { name } = client.assignedTo;
  return (
    <span className="flex min-w-0 items-center gap-2 text-text" title={name}>
      <Avatar name={name} size="md" />
      <span className="truncate">{shortName(name)}</span>
    </span>
  );
}

/** Message, email, documents and the ⋮ menu (archive and restore for Owner and Admin). */
function RowActions({
  client,
  manager,
  onAction,
}: {
  client: ClientListRow;
  manager: boolean;
  onAction: (client: ClientListRow, action: RowAction) => void;
}) {
  const router = useRouter();
  const base = `/clients/${client.id}`;
  const sections: ActionMenuSection[] = [
    {
      items: [
        { label: 'View profile', icon: Eye, onSelect: () => router.push(base) },
        { label: 'Invoices', icon: Receipt, onSelect: () => router.push(`${base}/invoices`) },
        { label: 'Signatures', icon: Signature, onSelect: () => router.push(`${base}/signatures`) },
      ],
    },
    ...(manager
      ? [
          {
            items: [
              client.archivedAt
                ? {
                    label: 'Restore client',
                    icon: ArrowCounterClockwise,
                    onSelect: () => onAction(client, 'RESTORE' as const),
                  }
                : {
                    label: 'Archive client',
                    icon: Archive,
                    danger: true,
                    onSelect: () => onAction(client, 'ARCHIVE' as const),
                  },
            ],
          },
        ]
      : []),
  ];
  return (
    <span className="flex items-center gap-1">
      <IconButton
        icon={ChatCircle}
        label={`Message ${client.displayName}`}
        onClick={() => router.push(`${base}/messages`)}
      />
      <IconButton
        icon={EnvelopeSimple}
        tone="danger"
        className="!border-danger-soft"
        label={client.email ? `Email ${client.email}` : 'No email on file'}
        disabled={!client.email}
        onClick={() => client.email && window.location.assign(`mailto:${client.email}`)}
      />
      <IconButton
        icon={FileText}
        tone="action"
        className="!border-folder-border"
        label={`Documents of ${client.displayName}`}
        onClick={() => router.push(`${base}/documents`)}
      />
      <ActionMenu
        label={`More actions for ${client.displayName}`}
        className="[&>button]:!size-8 [&>button]:!min-h-0 [&>button]:!justify-center [&>button]:!gap-0 [&>button]:!px-0 [&>button>svg:last-child]:hidden"
        trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
        sections={sections}
      />
    </span>
  );
}

interface ListProps {
  rows: ClientListRow[];
  total: number;
  page: number;
  pageSize: number;
  manager: boolean;
  selected: string[];
  onSelect: (ids: string[]) => void;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  onAction: (client: ClientListRow, action: RowAction) => void;
}

const columns: Column<ClientListRow>[] = [
  { id: 'name', label: 'Name / Company', className: 'w-37', cell: (c) => <NameCell client={c} /> },
  { id: 'type', label: 'Type', className: 'w-19', cell: (c) => <TypeBadge client={c} /> },
  { id: 'services', label: 'Services', className: 'w-28', cell: (c) => <Services client={c} /> },
  { id: 'status', label: 'Status', className: 'w-30', cell: (c) => <StageBadge client={c} /> },
  {
    id: 'missing',
    label: 'Missing Docs',
    className: 'w-22 text-center',
    cell: (c) => <MissingDocs client={c} />,
  },
  { id: 'balance', label: 'Balance Due', className: 'w-20', cell: (c) => <Balance client={c} /> },
  {
    id: 'activity',
    label: 'Last Activity',
    className: 'w-20',
    cell: (c) => <LastActivity at={c.lastActivityAt} />,
  },
  {
    id: 'appointment',
    label: 'Next Appointment',
    className: 'w-28',
    cell: (c) => <NextAppointment at={c.nextAppointmentAt} />,
  },
  { id: 'assigned', label: 'Assigned To', className: 'w-26', cell: (c) => <Assigned client={c} /> },
];

/**
 * The clients table of clients.jpg at desktop widths (newest first: the API has no sort, so the
 * headers don't sort). The numbered pages and "Show n per page" come from the API's `total`.
 */
export function ClientsTable(props: ListProps) {
  const { rows, total, page, pageSize, manager, selected, onSelect, onPage, onPageSize } = props;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div
      data-testid="clients-table"
      className="min-[90rem]:[&_.overflow-x-auto]:overflow-visible [&_[aria-current=page]]:!border-navigation [&_[aria-current=page]]:!bg-navigation"
    >
      <Table
        caption="Clients"
        rows={rows}
        columns={columns}
        rowKey={(client) => client.id}
        dense
        noun="clients"
        // Column widths measured from clients.jpg so every column fits at 1440 px.
        tableClassName={`table-fixed [&_th]:!px-1 [&_td]:!px-1 [&_th]:!whitespace-normal [&_th]:!text-heading [&_td]:!py-1.5 [&_th:first-child]:!pl-3 [&_td:first-child]:!pl-3 [&_th:last-child]:!w-40 [&_th:last-child]:!pr-3 [&_td:last-child]:!pr-3 ${manager ? '[&_th:first-child]:!w-9' : ''}`}
        pageSize={pageSize}
        pageSizes={PAGE_SIZES}
        onPageSize={onPageSize}
        server={{
          page,
          total,
          hasPrevious: page > 1,
          hasNext: page < pages,
          onPage,
          onNext: () => onPage(page + 1),
          onPrevious: () => onPage(page - 1),
          onSort: () => undefined,
        }}
        selection={manager ? { selected, onChange: onSelect } : undefined}
        rowActions={(client) => (
          <RowActions client={client} manager={manager} onAction={props.onAction} />
        )}
      />
    </div>
  );
}

/** One client on a phone: the table's columns stacked in a card. */
function ClientCard({
  client,
  manager,
  checked,
  onCheck,
  onAction,
}: {
  client: ClientListRow;
  manager: boolean;
  checked: boolean;
  onCheck: (on: boolean) => void;
  onAction: ListProps['onAction'];
}) {
  const facts: [string, ReactNode][] = [
    ['Missing Docs', <MissingDocs key="m" client={client} />],
    ['Balance Due', <Balance key="b" client={client} />],
    ['Last Activity', <LastActivity key="l" at={client.lastActivityAt} />],
    ['Next Appointment', <NextAppointment key="n" at={client.nextAppointmentAt} />],
  ];
  return (
    <li
      data-testid="client-card"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4"
    >
      <span className="flex min-w-0 items-start gap-3">
        {manager ? (
          <input
            type="checkbox"
            aria-label={`Select ${client.displayName}`}
            checked={checked}
            onChange={(event) => onCheck(event.target.checked)}
            className="mt-3 size-4 shrink-0 cursor-pointer rounded-sm"
          />
        ) : null}
        <span className="min-w-0 flex-1">
          <NameCell client={client} />
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2 text-xs">
        <TypeBadge client={client} />
        <StageBadge client={client} />
      </span>
      <Services client={client} />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {facts.map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-col gap-1">
            <dt className="font-medium text-heading">{label}</dt>
            <dd className="min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
      <span className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <Assigned client={client} />
        <RowActions client={client} manager={manager} onAction={onAction} />
      </span>
    </li>
  );
}

/** Below desktop width: the same rows as cards, select all on the page, and the same pager. */
export function ClientCards(props: ListProps) {
  const { rows, total, page, pageSize, manager, selected, onSelect, onPage, onPageSize } = props;
  const ids = rows.map((r) => r.id);
  const all = ids.length > 0 && ids.every((id) => selected.includes(id));
  const from = (page - 1) * pageSize + 1;
  const pick = (next: string[], on: boolean) => {
    const rest = selected.filter((id) => !next.includes(id));
    onSelect(on ? [...rest, ...next] : rest);
  };
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {manager ? (
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={all}
            onChange={(event) => pick(ids, event.target.checked)}
            className="size-4 cursor-pointer rounded-sm"
          />
          Select all on this page
        </label>
      ) : null}
      <ul className="grid min-w-0 gap-3 md:grid-cols-2">
        {rows.map((client) => (
          <ClientCard
            key={client.id}
            client={client}
            manager={manager}
            checked={selected.includes(client.id)}
            onCheck={(on) => pick([client.id], on)}
            onAction={props.onAction}
          />
        ))}
      </ul>
      <div className="[&_[aria-current=page]]:!border-navigation [&_[aria-current=page]]:!bg-navigation">
        <Pagination
          page={page}
          onPage={onPage}
          pageCount={Math.max(1, Math.ceil(total / pageSize))}
          summary={`Showing ${from} – ${Math.min(from + rows.length - 1, total)} of ${total} clients`}
          pageSize={pageSize}
          pageSizes={PAGE_SIZES}
          onPageSize={onPageSize}
        />
      </div>
    </div>
  );
}
