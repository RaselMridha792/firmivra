import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FacebookLogo, Lightbulb, ShieldCheck, UserPlus, UsersThree } from '@phosphor-icons/react';
import {
  buildOrgTree,
  CalendarGrid,
  Callout,
  checkFiles,
  ChecklistCard,
  ColorField,
  donutArcs,
  DonutChart,
  FileDropzone,
  HTTPS_LINK,
  LinkCard,
  monthWeeks,
  normalizeHex,
  OrgChart,
  percentOf,
  PermissionMatrix,
  placeDayEvents,
  plainTextLength,
  RichTextEditor,
  setRowAll,
  Timeline,
  toggleCell,
  weekDays,
} from './index';

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe('LinkCard', () => {
  it('is a link with title, description and the arrow button', () => {
    const out = html(
      <LinkCard
        icon={UserPlus}
        title="Create Staff Account"
        description="Add a new team member."
        href="/staff/new"
      />,
    );
    expect(out).toContain('href="/staff/new"');
    expect(out).toContain('Create Staff Account');
    expect(out).toContain('rounded-full bg-surface');
  });
  it('shows the text link instead of the arrow button, and is a button without href', () => {
    const out = html(
      <LinkCard icon={UsersThree} title="Users" actionLabel="Manage Access" surface="amber" />,
    );
    expect(out).toContain('<button');
    expect(out).toContain('Manage Access');
    expect(out).toContain('bg-amber-surface');
    expect(out).not.toContain('rounded-full bg-surface');
  });
});

describe('Callout', () => {
  it('renders the tip title in the action colour with its action', () => {
    const out = html(
      <Callout icon={Lightbulb} title="Pro Tip:" titleStyle="tip" action={<a href="#">Go</a>}>
        Send reminders.
      </Callout>,
    );
    expect(out).toContain('text-action');
    expect(out).toContain('Send reminders.');
    expect(out).toContain('Go</a>');
  });
  it('compact notices have no title tile', () => {
    expect(
      html(
        <Callout icon={ShieldCheck} size="compact" surface="success">
          Saved
        </Callout>,
      ),
    ).toContain('bg-success-soft');
  });
});

describe('ChecklistCard', () => {
  it('marks undone items for screen readers', () => {
    const out = html(
      <ChecklistCard
        title="Checklist"
        items={[
          { id: 'a', label: 'One', done: true },
          { id: 'b', label: 'Two', done: false },
        ]}
      />,
    );
    expect(out).toContain('(done)');
    expect(out).toContain('(not done)');
  });
  it('numbers steps and shows the empty text', () => {
    expect(
      html(<ChecklistCard title="Next" marker="number" items={[{ id: 'a', label: 'Go' }]} />),
    ).toContain('1.');
    expect(html(<ChecklistCard title="Empty" items={[]} emptyText="Nothing yet." />)).toContain(
      'Nothing yet.',
    );
  });
});

describe('DonutChart', () => {
  const segments = [
    { label: 'Completed', value: 12, tone: 'green' as const },
    { label: 'Submitted', value: 4, tone: 'blue' as const },
    { label: 'In Progress', value: 6, tone: 'yellow' as const },
    { label: 'Not Started', value: 1, tone: 'grey' as const },
    { label: 'Expired', value: 1, tone: 'red' as const },
  ];
  it('lays arcs end to end over the whole circle', () => {
    const arcs = donutArcs(segments);
    expect(arcs).toHaveLength(5);
    expect(arcs[0]?.fraction).toBeCloseTo(0.5);
    const last = arcs.at(-1)!;
    expect(last.offset + last.fraction).toBeCloseTo(1);
  });
  it('leaves the rest of a progress ring empty and skips zero segments', () => {
    expect(donutArcs([{ label: 'Done', value: 65, tone: 'green' }], 100)[0]?.fraction).toBeCloseTo(
      0.65,
    );
    expect(donutArcs([{ label: 'None', value: 0, tone: 'green' }])).toEqual([]);
  });
  it('shows the sum, the legend with percentages, and an empty ring with no data', () => {
    expect(percentOf(12, 24)).toBe('50%');
    expect(percentOf(3, 0)).toBe('0%');
    const out = html(<DonutChart segments={segments} centerLabel="Total Forms" />);
    expect(out).toContain('>24<');
    expect(out).toContain('12 (50%)');
    const empty = html(<DonutChart segments={[]} emptyText="No forms yet." />);
    expect(empty).toContain('No forms yet.');
    expect(empty).toContain('stroke-divider');
    expect(empty).not.toContain('<li');
  });
});

describe('RichTextEditor', () => {
  it('counts the text a reader sees', () => {
    expect(plainTextLength('<p>Hello <b>you</b></p><ul><li>A</li></ul>')).toBe(11);
    expect(plainTextLength('')).toBe(0);
  });
  it('accepts only https links', () => {
    expect(HTTPS_LINK.test('https://example.test/a')).toBe(true);
    expect(HTTPS_LINK.test('javascript:alert(1)')).toBe(false);
  });
  it('renders the toolbar, the counter and a disabled image button without an upload handler', () => {
    const out = html(
      <RichTextEditor
        label="Full Description"
        value="<p>Hi</p>"
        onChange={() => {}}
        maxLength={1000}
        required
      />,
    );
    for (const name of [
      'Bold',
      'Italic',
      'Underline',
      'Bulleted list',
      'Numbered list',
      'Insert link',
      'Quote',
    ]) {
      expect(out).toContain(`aria-label="${name}"`);
    }
    expect(out).toContain('2/1000');
    expect(out).toMatch(/aria-label="Insert image" disabled=""/);
  });
});

describe('ColorField', () => {
  it('normalizes hex codes', () => {
    expect(normalizeHex('#0A3D91')).toBe('#0a3d91');
    expect(normalizeHex('abc')).toBe('#aabbcc');
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
  });
  it('shows the hex in capitals and asks for a colour when empty', () => {
    expect(
      html(<ColorField label="Primary Color" value="#0a3d91" onChange={() => {}} />),
    ).toContain('#0A3D91');
    expect(html(<ColorField label="Accent" value="" onChange={() => {}} />)).toContain(
      'Use a colour like',
    );
  });
});

describe('FileDropzone', () => {
  const file = (name: string, type: string, size: number) => ({ name, type, size });
  it('accepts by extension or MIME type and refuses large files and extras', () => {
    const { accepted, rejected } = checkFiles(
      [
        file('a.pdf', 'application/pdf', 100),
        file('b.png', 'image/png', 100),
        file('c.exe', 'application/x-msdownload', 100),
        file('d.pdf', 'application/pdf', 99_999_999),
        file('e.jpg', 'image/jpeg', 100),
      ],
      { accept: ['.pdf', 'image/*'], maxBytes: 10_000_000, maxFiles: 2 },
    );
    expect(accepted.map((f) => f.name)).toEqual(['a.pdf', 'b.png']);
    expect(rejected.map((r) => r.reason)).toEqual(['type', 'size', 'count']);
  });
  it('draws "click" as a link and the hints', () => {
    const out = html(
      <FileDropzone label="Docs" onFiles={() => {}} hints={['Max size: 10MB per file']} />,
    );
    expect(out).toContain('<span class="text-link">click</span>');
    expect(out).toContain('Max size: 10MB per file');
  });
});

describe('Timeline', () => {
  it('lists items with time and actor, or the empty text', () => {
    const out = html(
      <Timeline
        items={[
          {
            id: '1',
            icon: FacebookLogo,
            title: 'Lead created',
            time: 'Sep 18, 2026',
            actor: 'System',
          },
        ]}
      />,
    );
    expect(out).toContain('<ol');
    expect(out).toContain('Lead created');
    expect(out).toContain('System');
    expect(html(<Timeline items={[]} emptyText="No activity yet." />)).toContain(
      'No activity yet.',
    );
  });
});

describe('OrgChart', () => {
  it('builds the tree, keeps orphans as tops and breaks loops', () => {
    const tree = buildOrgTree([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'c', name: 'C', parentId: 'gone' },
      { id: 'x', name: 'X', parentId: 'y' },
      { id: 'y', name: 'Y', parentId: 'x' },
    ]);
    expect(tree.map((n) => n.person.id)).toEqual(['a', 'c', 'x']);
    expect(tree[0]?.children[0]?.person.id).toBe('b');
    expect(tree[2]?.children[0]?.person.id).toBe('y');
  });
  it('shows the empty text with nobody', () => {
    expect(html(<OrgChart people={[]} emptyText="No people yet." />)).toContain('No people yet.');
  });
});

describe('PermissionMatrix', () => {
  const columns = ['view', 'create', 'edit', 'delete'].map((id) => ({ id, label: id }));
  const requires = { create: 'view', edit: 'view', delete: 'edit' };
  it('adds what a capability needs, and removes what needs a removed one', () => {
    const on = toggleCell({}, 'clients', 'delete', true, { columns, requires });
    expect([...(on.clients ?? [])].sort()).toEqual(['delete', 'edit', 'view']);
    const off = toggleCell(on, 'clients', 'view', false, { columns, requires });
    expect(off.clients).toEqual([]);
    expect(setRowAll({}, 'clients', true, { columns }).clients).toEqual([
      'view',
      'create',
      'edit',
      'delete',
    ]);
  });
  it('renders a labelled checkbox per cell and ticks Full Access when every cell is on', () => {
    const out = html(
      <PermissionMatrix
        rows={[{ id: 'clients', label: 'Clients' }]}
        columns={columns}
        value={{ clients: ['view', 'create', 'edit', 'delete'] }}
        fullAccess
      />,
    );
    expect(out).toContain('aria-label="Clients: view"');
    expect(out).toMatch(/aria-label="Clients: Full Access"[^>]*checked=""/);
  });
});

describe('CalendarGrid', () => {
  it('builds weeks and months', () => {
    const week = weekDays(new Date(2026, 8, 23));
    expect(week[0]?.getDate()).toBe(20);
    expect(week[6]?.getDate()).toBe(26);
    const month = monthWeeks(new Date(2026, 8, 1));
    expect(month).toHaveLength(5);
    expect(month[0]?.[2]).toMatchObject({ inMonth: true });
    expect(month[0]?.[2]?.date.getDate()).toBe(1);
    expect(month[0]?.[0]?.inMonth).toBe(false);
  });
  it('places events in the visible hours and splits overlaps into lanes', () => {
    const day = new Date(2026, 8, 21);
    const placed = placeDayEvents(
      [
        { id: 'a', title: 'A', start: new Date(2026, 8, 21, 9), end: new Date(2026, 8, 21, 10) },
        {
          id: 'b',
          title: 'B',
          start: new Date(2026, 8, 21, 9, 30),
          end: new Date(2026, 8, 21, 10, 30),
        },
        { id: 'c', title: 'C', start: new Date(2026, 8, 21, 13), end: new Date(2026, 8, 21, 14) },
        { id: 'd', title: 'D', start: new Date(2026, 8, 22, 9), end: new Date(2026, 8, 22, 10) },
      ],
      day,
      8,
      18,
    );
    expect(placed.map((p) => p.event.id)).toEqual(['a', 'b', 'c']);
    expect(placed[0]).toMatchObject({ top: 0.1, height: 0.1, lane: 0, lanes: 2 });
    expect(placed[1]).toMatchObject({ lane: 1, lanes: 2 });
    expect(placed[2]).toMatchObject({ lane: 0, lanes: 1 });
  });
  it('marks today and draws an empty week with no events', () => {
    const today = new Date(2026, 8, 21);
    const out = html(<CalendarGrid view="week" date={today} today={today} />);
    expect(out).toContain('aria-current="date"');
    expect(out).toContain('8:00 AM');
    const mini = html(
      <CalendarGrid view="mini" date={today} today={today} onPrev={() => {}} onNext={() => {}} />,
    );
    expect(mini).toContain('September 2026');
  });
});
