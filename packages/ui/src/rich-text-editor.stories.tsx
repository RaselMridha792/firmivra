import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { RichTextEditor, type RichTextEditorProps } from './index';

const meta = {
  title: 'Firm Backend/RichTextEditor',
  component: RichTextEditor,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof RichTextEditor>;
export default meta;
type Story = StoryObj<typeof meta>;

function Editor(props: Omit<RichTextEditorProps, 'onChange'>) {
  const [value, setValue] = useState(props.value);
  return (
    <div className="max-w-xl">
      <RichTextEditor {...props} value={value} onChange={setValue} />
    </div>
  );
}

const base = {
  label: 'Full Description (Client-Facing)',
  required: true,
  maxLength: 1000,
  onChange: () => {},
};

/** Services & Pricing' Full Description. */
export const Default: Story = {
  args: {
    ...base,
    value:
      '<p>Our personal tax preparation service includes a complete review of your tax situation to maximize your refund and ensure accurate, compliant filing. We handle W-2 income, 1099 income, and self-employment income.</p>',
  },
  render: (args) => <Editor {...args} />,
};

export const Empty: Story = {
  args: { ...base, value: '', placeholder: 'Describe the service for clients' },
  render: (args) => <Editor {...args} />,
};

export const LongText: Story = {
  args: {
    ...base,
    maxLength: 200,
    value: `<p>${'A long description that runs past the limit so the counter turns red. '.repeat(5)}</p><ul><li>Review of all tax documents</li><li>Federal and state filing</li></ul>`,
  },
  render: (args) => <Editor {...args} />,
};
