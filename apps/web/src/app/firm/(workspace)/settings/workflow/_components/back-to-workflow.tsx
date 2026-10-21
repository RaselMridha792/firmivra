import { ArrowLeft } from '@phosphor-icons/react/ssr';
import { CardLink } from '../../_components/settings-parts';

/** The hub's own address: the only place the button goes, never one taken from the URL. */
const HUB = '/settings/workflow';

/** The `?from=` value the hub's links carry; any other value shows no button. */
const FROM = 'workflow';

/** A link from Workflow & Automations: the page it opens offers the way back (guide, return navigation). */
export function fromWorkflow(path: string): string {
  return `${path}?from=${FROM}`;
}

/** Whether a page was opened from the hub; the marker is in the URL, so it survives a refresh. */
export function openedFromWorkflow(from: string | string[] | undefined): boolean {
  return from === FROM;
}

/** Back to Workflow & Automations, beside the page's own back link when it has one. */
export function BackToWorkflow() {
  return (
    <CardLink href={HUB}>
      <span className="inline-flex items-center gap-2">
        <ArrowLeft aria-hidden weight="bold" className="size-4" />
        Back to Workflow &amp; Automations
      </span>
    </CardLink>
  );
}
