import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { describedBy } from './field-hint';
import { Input } from './input';
import { Textarea } from './textarea';
import { Select } from './fields';

// B14 (Octavia's review of Oct 25): persistent helper text below the label and above the control,
// associated with it, and nothing changes for a field without one.

const HINT = 'Describe who currently buys your products or services.';
const options = [{ value: '', label: 'Choose' }];
const fields = {
  Input: (p: { hint?: string; error?: string }) => (
    <Input id="f" label="Current Customers" {...p} />
  ),
  Textarea: (p: { hint?: string; error?: string }) => (
    <Textarea id="f" label="Current Customers" {...p} />
  ),
  Select: (p: { hint?: string; error?: string }) => (
    <Select id="f" label="Current Customers" options={options} {...p} />
  ),
};

describe.each(Object.entries(fields))('%s hint', (_name, Field) => {
  it('sits between the label and the control and describes the control', () => {
    const html = renderToStaticMarkup(<Field hint={HINT} />);
    const label = html.indexOf('</label>');
    const hint = html.indexOf(`<p id="f-hint" class="text-sm text-muted">${HINT}</p>`);
    const control = html.search(/<(input|textarea|select) /);
    expect(label).toBeGreaterThan(-1);
    expect(hint).toBeGreaterThan(label);
    expect(control).toBeGreaterThan(hint);
    expect(html).toContain('aria-describedby="f-hint"');
  });

  it('is described by the hint and then the error when both are shown', () => {
    const html = renderToStaticMarkup(<Field hint={HINT} error="Enter the customers." />);
    expect(html).toContain('aria-describedby="f-hint f-error"');
  });

  it('changes nothing when there is no hint', () => {
    const html = renderToStaticMarkup(<Field />);
    expect(html).not.toContain('f-hint');
    expect(html).not.toContain('aria-describedby');
    expect(renderToStaticMarkup(<Field error="Enter the customers." />)).toContain(
      'aria-describedby="f-error"',
    );
  });
});

describe('describedBy', () => {
  it('names the hint, then the error, or nothing', () => {
    expect(describedBy('x')).toBeUndefined();
    expect(describedBy('x', 'Help')).toBe('x-hint');
    expect(describedBy('x', undefined, 'Wrong')).toBe('x-error');
    expect(describedBy('x', 'Help', 'Wrong')).toBe('x-hint x-error');
  });
});
