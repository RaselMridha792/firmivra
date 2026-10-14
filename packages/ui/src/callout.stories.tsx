import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ArrowRight,
  ArrowSquareOut,
  Lightbulb,
  LockSimple,
  Question,
  ShieldCheck,
} from '@phosphor-icons/react';
import { Button, Callout } from './index';

const meta = {
  title: 'Firm Backend/Callout',
  component: Callout,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Callout>;
export default meta;
type Story = StoryObj<typeof meta>;

const tipLink = (
  <a href="#" className="inline-flex items-center gap-1 text-sm font-semibold text-link underline">
    Go to Automations <ArrowRight aria-hidden weight="bold" className="size-4" />
  </a>
);

/** Pro Tip (Appointments, Intake Forms). */
export const Default: Story = {
  args: {
    icon: Lightbulb,
    title: 'Pro Tip:',
    titleStyle: 'tip',
    children: 'Use automated reminders and follow-ups to increase completion rates and save time.',
    action: tipLink,
  },
  render: (args) => (
    <div className="max-w-sm">
      <Callout {...args} />
    </div>
  ),
};

/** "Need Help?" (Staff Management), the green and amber notices beside forms. */
export const Variants: Story = {
  args: { icon: Question },
  render: () => (
    <div className="flex max-w-md flex-col gap-4">
      <Callout
        icon={Question}
        tone="navy"
        surface="plain"
        title="Need Help?"
        action={
          <Button variant="outline" className="w-full">
            <ArrowSquareOut aria-hidden weight="bold" className="size-4" /> View Guide
          </Button>
        }
      >
        Check out our Staff Management Guide or contact support.
      </Callout>
      <Callout icon={ShieldCheck} tone="green" surface="success" size="compact">
        Your branding changes will be applied throughout the system, including the client portal,
        emails, and documents.
      </Callout>
      <Callout icon={LockSimple} tone="navy" surface="warning" size="compact">
        Compensation details are only visible to administrators and authorized HR personnel.
      </Callout>
    </div>
  ),
};

/** Only the icon and title: no text yet. */
export const Empty: Story = {
  args: { icon: Lightbulb, title: 'Pro Tip:', titleStyle: 'tip' },
  render: (args) => (
    <div className="max-w-sm">
      <Callout {...args} />
    </div>
  ),
};

export const LongText: Story = {
  args: {
    icon: Lightbulb,
    title:
      'Pro Tip: keep every staff member’s availability up to date before the busy season starts',
    titleStyle: 'tip',
    children:
      'Clients book only the times your team marks as available. Add date-specific overrides for holidays, block personal time, and connect Google or Outlook calendars so that busy times are never offered to clients who book online from the portal.',
    action: tipLink,
  },
  render: (args) => (
    <div className="max-w-sm">
      <Callout {...args} />
    </div>
  ),
};
