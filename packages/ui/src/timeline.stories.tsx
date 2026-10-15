import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Bell,
  CheckCircle,
  ClipboardText,
  EnvelopeSimple,
  Eye,
  FacebookLogo,
  GearSix,
  Palette,
  PaperPlaneTilt,
  Tag,
  Target,
} from '@phosphor-icons/react';
import { Timeline } from './index';

const meta = {
  title: 'Firm Backend/Timeline',
  component: Timeline,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Timeline>;
export default meta;
type Story = StoryObj<typeof meta>;

const at = 'Sep 18, 2026, 10:24 AM';

/** Lead Profile's Recent Activity. */
export const Default: Story = {
  args: {
    items: [
      {
        id: '1',
        icon: FacebookLogo,
        tone: 'blue',
        title: (
          <>
            Lead created from <b>Facebook Ad</b>
          </>
        ),
        time: at,
        actor: 'System',
      },
      {
        id: '2',
        icon: Target,
        tone: 'blue',
        title: (
          <>
            Status changed to <b>New Lead</b>
          </>
        ),
        time: at,
        actor: 'System',
      },
      {
        id: '3',
        icon: EnvelopeSimple,
        tone: 'blue',
        title: (
          <>
            Email sent: <b>Welcome to LVP</b>
          </>
        ),
        time: 'Sep 18, 2026, 10:30 AM',
        actor: 'K. Allen',
      },
      {
        id: '4',
        icon: ClipboardText,
        tone: 'amber',
        title: 'Website form submitted',
        time: at,
        actor: 'System',
      },
      {
        id: '5',
        icon: Tag,
        tone: 'amber',
        title: (
          <>
            Tag added: <b>Back Taxes Campaign</b>
          </>
        ),
        time: at,
        actor: 'System',
      },
    ],
  },
  render: (args) => (
    <div className="max-w-lg">
      <Timeline {...args} />
    </div>
  ),
};

/** Intake's Activity Timeline and Settings' Recent Changes. */
export const Variants: Story = {
  args: { items: [] },
  render: () => (
    <div className="flex max-w-md flex-col gap-8">
      <Timeline
        variant="connected"
        items={[
          {
            id: '1',
            icon: PaperPlaneTilt,
            tone: 'blue',
            title: 'Form Sent to Client',
            time: 'Sep 10, 2026 9:00 AM',
          },
          {
            id: '2',
            icon: Eye,
            tone: 'blue',
            title: 'Client Opened Form',
            time: 'Sep 10, 2026 2:34 PM',
          },
          {
            id: '3',
            icon: CheckCircle,
            tone: 'green',
            title: 'Form Submitted',
            time: 'Sep 11, 2026 10:24 AM',
          },
          {
            id: '4',
            icon: CheckCircle,
            tone: 'green',
            title: 'Marked as Completed',
            time: 'Sep 11, 2026 10:24 AM',
          },
        ]}
      />
      <Timeline
        variant="plain"
        items={[
          {
            id: '1',
            icon: GearSix,
            tone: 'blue',
            title: 'Updated form expiration to 14 days',
            time: 'Today at 10:24 AM',
            actor: 'Morgan Avery',
          },
          {
            id: '2',
            icon: Bell,
            tone: 'purple',
            title: 'Enabled email reminders',
            time: 'Sep 11, 2026 2:15 PM',
            actor: 'Priya Ramos',
          },
          {
            id: '3',
            icon: Palette,
            tone: 'amber',
            title: 'Updated branding colors',
            time: 'Sep 10, 2026 4:32 PM',
            actor: 'Morgan Avery',
          },
        ]}
      />
    </div>
  ),
};

export const Empty: Story = { args: { items: [], emptyText: 'No activity yet.' } };

export const LongText: Story = {
  args: {
    items: [
      {
        id: '1',
        icon: EnvelopeSimple,
        tone: 'blue',
        title:
          'Email sent: Welcome to LVP Accounting & Taxes, here is everything you need to get your 2025 return started',
        time: at,
        actor: 'Alexandria Montgomery-Whitfield',
      },
    ],
  },
  render: (args) => (
    <div className="max-w-md">
      <Timeline {...args} />
    </div>
  ),
};
