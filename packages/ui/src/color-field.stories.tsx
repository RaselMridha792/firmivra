import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ColorField, type ColorFieldProps } from './index';

const meta = {
  title: 'Firm Backend/ColorField',
  component: ColorField,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ColorField>;
export default meta;
type Story = StoryObj<typeof meta>;

function Field(props: Omit<ColorFieldProps, 'onChange'>) {
  const [value, setValue] = useState(props.value);
  return <ColorField {...props} value={value} onChange={setValue} />;
}

/** Settings' Brand Colors. */
export const Default: Story = {
  args: { label: 'Primary Color', value: '#0a3d91', onChange: () => {} },
  render: () => (
    <div className="grid max-w-3xl grid-cols-4 gap-4">
      <Field label="Primary Color" value="#0a3d91" />
      <Field label="Secondary Color" value="#d4af37" />
      <Field label="Accent Color" value="#1e73f8" />
      <Field label="Background Color" value="#f5f8ff" />
    </div>
  ),
};

/** Intake Form Settings' named colours ("LVP Blue"). */
export const Presets: Story = {
  args: { label: 'Primary button color', value: '#0a3d91', onChange: () => {} },
  render: (args) => (
    <div className="max-w-xs">
      <Field
        {...args}
        presets={[
          { name: 'LVP Blue', value: '#0a3d91' },
          { name: 'LVP Gold', value: '#d4af37' },
        ]}
      />
    </div>
  ),
};

/** Nothing typed yet: the field asks for a colour. */
export const Empty: Story = {
  args: { label: 'Accent Color', value: '', onChange: () => {} },
  render: (args) => (
    <div className="max-w-xs">
      <Field {...args} />
    </div>
  ),
};

export const LongText: Story = {
  args: {
    label: 'Background colour of the client portal sign-in page and every email header',
    value: '#f5f8ff',
    hint: 'Keep it light so text stays readable; Firmivra checks the contrast before saving.',
    onChange: () => {},
  },
  render: (args) => (
    <div className="max-w-xs">
      <Field {...args} />
    </div>
  ),
};
