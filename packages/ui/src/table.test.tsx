import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Table } from './table';

const columns = [
  { id: 'period', label: 'Pay Period', cell: (r: { id: string }) => r.id },
  { id: 'gross', label: 'Gross', cell: () => '—' },
];

describe('Table empty state', () => {
  it('replaces the table by default', () => {
    const html = renderToStaticMarkup(
      <Table
        rows={[]}
        columns={columns}
        rowKey={(r) => r.id}
        caption="Runs"
        emptyTitle="No runs"
      />,
    );
    expect(html).toContain('No runs');
    expect(html).not.toContain('<table');
  });

  it('keeps the headings, with the empty state as one row, when asked (PY-F09)', () => {
    const html = renderToStaticMarkup(
      <Table
        rows={[]}
        columns={columns}
        rowKey={(r) => r.id}
        caption="Runs"
        emptyTitle="No runs"
        keepHeaderWhenEmpty
        rowActions={() => null}
      />,
    );
    expect(html).toContain('<table');
    expect(html).toContain('Pay Period');
    expect(html).toContain('Gross');
    expect(html).toContain('colSpan="3"');
    expect(html).toContain('No runs');
    expect(html).not.toContain('Showing');
  });
});

describe('Table without a pager (showPagination false)', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    id: `row-${String(i + 1).padStart(2, '0')}`,
  }));
  const render = (pageSize?: number) =>
    renderToStaticMarkup(
      <Table
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        caption="Types"
        showPagination={false}
        {...(pageSize === undefined ? {} : { pageSize })}
      />,
    );

  it('shows every row it is given, past the default ten (Manage Appointment Types, Nov 18)', () => {
    const html = render();
    for (const r of rows) expect(html).toContain(r.id);
  });

  it('caps the list only when the caller gives its own pageSize (a "top N" card)', () => {
    const html = render(5);
    expect(html).toContain('row-05');
    expect(html).not.toContain('row-06');
  });
});
