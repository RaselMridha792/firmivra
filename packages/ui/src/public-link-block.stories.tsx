import type { Meta, StoryObj } from '@storybook/react-vite';
import { PublicLinkBlock } from './index';

const meta = {
  title: 'Firm Backend/PublicLinkBlock',
  component: PublicLinkBlock,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof PublicLinkBlock>;
export default meta;
type Story = StoryObj<typeof meta>;

const url = 'https://portal.firmivra.com/lvp/book/0f000000-0000-4000-a000-000000000001';
const embedCode = `<iframe src="${url}?embed=1" title="Tax Consultation" width="100%" height="760" style="border:0;max-width:100%" loading="lazy"></iframe>`;

/** An active appointment type: Copy Booking Link and Copy Embed Code. */
export const Default: Story = {
  args: {
    url,
    embedCode,
    title: 'Booking Link',
    copyLinkLabel: 'Copy Booking Link',
  },
};

/** An archived item keeps its link, which refuses new bookings until it is restored. */
export const NotTakingBookings: Story = {
  args: {
    ...Default.args,
    url,
    embedCode,
    notice:
      'This appointment type is archived. The link stays the same, but it takes no new bookings until the type is restored.',
  },
};

/** No link yet (still loading, or public booking is not available). */
export const Empty: Story = {
  args: {
    url: null,
    embedCode: null,
    title: 'Form Link',
    emptyText: 'The form link appears here once the form is published.',
  },
};

/** A refused clipboard selects the text instead. */
export const CopyBlocked: Story = {
  args: {
    ...Default.args,
    url,
    embedCode,
    copy: () => Promise.reject(new Error('blocked')),
  },
};
