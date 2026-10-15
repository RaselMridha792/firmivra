import type { Meta, StoryObj } from '@storybook/react-vite';
import { DonutChart } from './index';

const meta = {
  title: 'Firm Backend/DonutChart',
  component: DonutChart,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof DonutChart>;
export default meta;
type Story = StoryObj<typeof meta>;

const frame = (child: React.ReactNode) => (
  <div className="max-w-sm rounded-xl border border-border bg-surface p-5">
    <h3 className="mb-4 text-lg font-bold text-heading">Form Status Chart</h3>
    {child}
  </div>
);

/** Intake Forms' Form Status Chart. */
export const Default: Story = {
  args: {
    centerLabel: 'Total Forms',
    segments: [
      { label: 'Completed', value: 12, tone: 'green' },
      { label: 'Submitted', value: 4, tone: 'blue' },
      { label: 'In Progress', value: 6, tone: 'yellow' },
      { label: 'Not Started', value: 1, tone: 'grey' },
      { label: 'Expired', value: 1, tone: 'red' },
    ],
  },
  render: (args) => frame(<DonutChart {...args} />),
};

/** Submission Summary's progress ring. */
export const ProgressRing: Story = {
  args: {
    segments: [{ label: 'Completed', value: 65, tone: 'green' }],
    total: 100,
    centerValue: '65%',
    centerLabel: 'Completed',
    legend: false,
  },
};

/** No forms yet: the grey ring, 0 in the middle, and the empty text. */
export const Empty: Story = {
  args: { centerLabel: 'Total Forms', segments: [], emptyText: 'No forms sent yet.' },
  render: (args) => frame(<DonutChart {...args} />),
};

export const LongText: Story = {
  args: {
    centerLabel: 'Total intake forms sent this tax season',
    segments: [
      { label: 'Completed and reviewed by the assigned preparer', value: 120, tone: 'green' },
      { label: 'Submitted, waiting for review', value: 1300, tone: 'blue' },
      { label: 'Expired before the client finished', value: 7, tone: 'red' },
    ],
  },
  render: (args) => frame(<DonutChart {...args} />),
};
