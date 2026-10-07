import type { Meta, StoryObj } from '@storybook/react-vite';
import { Radio, Stepper } from './index';

const meta = {
  title: 'Design System/Progress and choices',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const RadioGroup: Story = {
  render: () => (
    <fieldset>
      <legend className="font-semibold">Contact preference</legend>
      <Radio label="Email" name="contact" value="email" defaultChecked />
      <Radio label="Phone" name="contact" value="phone" />
      <Radio label="Unavailable preference" name="contact" value="unavailable" disabled />
    </fieldset>
  ),
};
export const SetupSteps: Story = {
  render: () => (
    <Stepper
      current="details"
      steps={[
        { id: 'brand', label: 'Branding' },
        { id: 'details', label: 'Business details' },
        { id: 'finish', label: 'Finish setup' },
      ]}
    />
  ),
};
