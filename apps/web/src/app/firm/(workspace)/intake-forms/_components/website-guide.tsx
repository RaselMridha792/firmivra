'use client';

// Leads Review Two, row 24 (website lead capture): where to put a form's link or website button
// on the common website builders, and how a link carries its campaign. Plain steps, no plug-in:
// the link works on any site that takes a link, the embed code on any site that takes HTML.

const PLATFORMS: { name: string; steps: string }[] = [
  {
    name: 'WordPress',
    steps:
      'In the page editor, add a Buttons block and paste the link; or add a Custom HTML block and paste the embed code.',
  },
  {
    name: 'Wix',
    steps:
      'Choose Add, then Embed Code, then Embed HTML, and paste the embed code; or add a Button and set its link to the form’s link.',
  },
  {
    name: 'GoDaddy',
    steps:
      'In the Website Builder, add a section, choose HTML and paste the embed code; or add a button and link it to the form’s link.',
  },
  {
    name: 'Shopify',
    steps:
      'In Online Store, open Pages, choose a page, switch the editor to Show HTML and paste the embed code; or add the link to a menu.',
  },
  {
    name: 'Any other site',
    steps:
      'Use the link wherever a web address goes: a menu, a button, an email or a social profile.',
  },
];

export function WebsiteGuide() {
  return (
    <details className="rounded-lg border border-border p-3 text-sm" data-testid="website-guide">
      <summary className="cursor-pointer font-semibold text-heading">
        How to add it to your website
      </summary>
      <dl className="mt-3 flex flex-col gap-2">
        {PLATFORMS.map((p) => (
          <div key={p.name}>
            <dt className="font-semibold text-heading">{p.name}</dt>
            <dd className="text-text">{p.steps}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted">
        To see where visitors came from, add your campaign to the link, for example
        ?utm_source=google&amp;utm_medium=cpc&amp;utm_campaign=spring. Each lead from it shows the
        campaign as its source detail. A visitor whose email you already have is listed in Leads
        &gt; Review Duplicates once they submit, never merged by itself.
      </p>
    </details>
  );
}
