import { Avatar } from './avatar';

export interface OrgChartPerson {
  id: string;
  name: string;
  /** "Tax Manager". */
  title?: string;
  /** Who they report to; null or unknown makes them a top of the chart. */
  parentId?: string | null;
  avatarSrc?: string;
  /** A small line under the title: "Tax", "Head of Bookkeeping". */
  note?: string;
}

export interface OrgNode {
  person: OrgChartPerson;
  children: OrgNode[];
}

/**
 * The reporting tree. People whose manager is not in the list are tops; a loop (A reports to B,
 * B to A) is broken at the first person seen, so every person shows exactly once.
 */
export function buildOrgTree(people: OrgChartPerson[]): OrgNode[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const children = new Map<string, OrgChartPerson[]>();
  const roots: OrgChartPerson[] = [];
  for (const p of people) {
    const parent = p.parentId && p.parentId !== p.id ? byId.get(p.parentId) : undefined;
    if (parent) children.set(parent.id, [...(children.get(parent.id) ?? []), p]);
    else roots.push(p);
  }
  const seen = new Set<string>();
  const grow = (p: OrgChartPerson): OrgNode => {
    seen.add(p.id);
    return {
      person: p,
      children: (children.get(p.id) ?? []).filter((c) => !seen.has(c.id)).map(grow),
    };
  };
  const tree = roots.map(grow);
  // People only reachable through a loop: start a top at each one not drawn yet.
  for (const p of people) if (!seen.has(p.id)) tree.push(grow(p));
  return tree;
}

function PersonCard({ person }: { person: OrgChartPerson }) {
  return (
    <div className="flex w-56 items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left shadow-sm">
      <Avatar name={person.name} src={person.avatarSrc} size="lg" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold text-heading">{person.name}</span>
        {person.title ? <span className="truncate text-xs text-muted">{person.title}</span> : null}
        {person.note ? <span className="truncate text-xs text-link">{person.note}</span> : null}
      </span>
    </div>
  );
}

function Branch({ node }: { node: OrgNode }) {
  return (
    <li className="flex flex-col items-center">
      <PersonCard person={node.person} />
      {node.children.length ? (
        <>
          <span aria-hidden className="h-5 w-0.5 bg-folder-border" />
          <ul className="flex gap-6">
            {node.children.map((child, i) => (
              <li key={child.person.id} className="relative flex flex-col items-center pt-5">
                {/* The line across the siblings, and the drop to this card. */}
                <span
                  aria-hidden
                  className={`absolute top-0 h-0.5 bg-folder-border ${i === 0 ? 'left-1/2' : '-left-3'} ${i === node.children.length - 1 ? 'right-1/2' : '-right-3'}`}
                />
                <span aria-hidden className="absolute top-0 h-5 w-0.5 bg-folder-border" />
                <ul>
                  <Branch node={child} />
                </ul>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </li>
  );
}

export interface OrgChartProps {
  people: OrgChartPerson[];
  emptyText?: string;
  label?: string;
}

/** Teams & Departments' Org Chart: people as cards joined by reporting lines. Scrolls sideways. */
export function OrgChart({
  people,
  emptyText = 'No reporting lines yet. Set each person’s manager to build the chart.',
  label = 'Org chart',
}: OrgChartProps) {
  if (people.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-subtle p-8 text-center text-sm text-muted">
        {emptyText}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto pb-2">
      <ul aria-label={label} className="flex w-max min-w-full justify-center gap-10 p-2">
        {buildOrgTree(people).map((node) => (
          <Branch key={node.person.id} node={node} />
        ))}
      </ul>
    </div>
  );
}
