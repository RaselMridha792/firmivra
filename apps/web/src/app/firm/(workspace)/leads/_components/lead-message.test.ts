import { describe, expect, it } from 'vitest';
import {
  htmlToText,
  MESSAGE_ERRORS,
  recipientOf,
  sendSummary,
  withSignature,
} from './lead-message';

// Octavia's Leads review, item 9: the composer says what happened, never "Something went wrong".
const lead = (id: string, phone: string | null) =>
  recipientOf({ id, firstName: 'Fake', lastName: `Lead ${id}`, email: `${id}@leads.test`, phone });

describe('sendSummary', () => {
  it('counts what went, who had no number and what could not be sent', () => {
    const people = [lead('a', '+15555550101'), lead('b', null), lead('c', '+15555550103')];
    expect(sendSummary({ changed: 2, skipped: 1 }, people, 'SMS')).toBe(
      'Text sent to 2 leads. 1 without a saved phone number was left out.',
    );
    expect(sendSummary({ changed: 1, skipped: 2 }, people, 'SMS')).toBe(
      'Text sent to 1 lead. 1 without a saved phone number was left out. 1 could not be sent (no longer available to you, or the provider refused it); try again later.',
    );
    expect(sendSummary({ changed: 0, skipped: 1 }, [lead('a', '1')], 'EMAIL')).toBe(
      'Email not sent. 1 could not be sent (no longer available to you, or the provider refused it); try again later.',
    );
  });

  it('names the lead and says plainly when texts are not set up', () => {
    expect(lead('x', null).name).toBe('Fake Lead x');
    expect(MESSAGE_ERRORS['SMS_UNAVAILABLE']).toMatch(/not set up for this firm yet/);
  });
});

// Item 8 (L4): a formatted email also goes out as plain text, counted toward 5000 characters.
describe('htmlToText', () => {
  it('keeps one line per paragraph, break and list item, and reads entities', () => {
    expect(
      htmlToText(
        '<p><b>Hello</b> Robin,</p><div>Line<br>break</div><ul><li>one</li><li>two</li></ul><p>Tom &amp; Jerry &lt;3&nbsp;&#8364;</p>',
      ),
    ).toBe('Hello Robin,\nLine\nbreak\n- one\n- two\n\nTom & Jerry <3 €');
  });

  it('drops images, zero-width marks and empty paragraphs', () => {
    expect(htmlToText('<p><img src="x.png"></p><p><br></p><p><br></p><p><br></p><p>​Hi</p>')).toBe(
      'Hi',
    );
    expect(htmlToText('<p><img src="x.png"></p>')).toBe('');
  });

  it('ends a line of text that runs straight into a block', () => {
    expect(htmlToText('Owner Sample<div>LVP Accounting &amp; Taxes</div>')).toBe(
      'Owner Sample\nLVP Accounting & Taxes',
    );
  });
});

describe('withSignature', () => {
  it('adds the signature after a blank line, or nothing', () => {
    expect(withSignature('<p>Hi</p>', '<p>Pat</p>')).toBe('<p>Hi</p><p><br></p><p>Pat</p>');
    expect(withSignature('<p>Hi</p>', null)).toBe('<p>Hi</p>');
  });
});
