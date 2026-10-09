import type { Meta, StoryObj } from '@storybook/react-vite';
import { PageContainer, PageSection } from './page-container';

const meta = {
  title: 'Design System/Page Container',
  component: PageContainer,
  parameters: { layout: 'fullscreen' },
  args: { children: 'Public pages share one width (1120px) and the same side padding.' },
} satisfies Meta<typeof PageContainer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Public: Story = {};
export const Content: Story = { args: { width: 'content' } };
/** A full-width band: the background runs edge to edge, the content lines up with PageContainer. */
export const Section: Story = {
  render: (args) => (
    <PageSection className="bg-folder-surface py-12">
      <h1 className="text-3xl font-bold text-heading">{args.children}</h1>
    </PageSection>
  ),
};
