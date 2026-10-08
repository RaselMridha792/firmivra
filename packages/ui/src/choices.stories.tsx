import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge, Button, Checkbox, Radio, Select } from './index';
import mockFirmSettings from './mocks/firm-branding.json';

const meta = { title: 'Design System/Choices', parameters: { layout: 'padded' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const SelectField: Story = {
  render: () => (
    <Select
      label="Service"
      options={[
        { value: '', label: 'Choose a service' },
        { value: 'books', label: 'Bookkeeping' },
      ]}
    />
  ),
};
export const CheckboxField: Story = { render: () => <Checkbox label="I agree to the Terms" /> };
export const RadioGroup: Story = {
  render: () => (
    <fieldset>
      <legend>Contact preference</legend>
      <Radio label="Email" name="contact" value="email" defaultChecked />
      <Radio label="Phone" name="contact" value="phone" />
      <Radio label="Unavailable" name="contact" value="unavailable" disabled />
    </fieldset>
  ),
};
export const StatusBadge: Story = {
  render: () => (
    <div className="flex gap-3">
      <Badge tone="success">Paid</Badge>
      <Badge tone="warning">Pending</Badge>
      <Badge tone="danger">Overdue</Badge>
    </div>
  ),
};
export const BrandThemes: Story = {
  render: () => (
    <div className="grid gap-6">
      {['firmivra', 'portal', 'begin-online'].map((theme) => (
        <section
          key={theme}
          data-theme={theme}
          className="space-y-3"
          ref={(element) => {
            if (!element || theme === 'firmivra') return;
            // Simulate the portal layout applying settings returned by the API.
            element.style.setProperty('--color-firm-primary', mockFirmSettings.primary);
            element.style.setProperty('--color-firm-accent', mockFirmSettings.accent);
            if (theme === 'begin-online')
              element.style.setProperty('--color-firm-intake', mockFirmSettings.intake);
          }}
        >
          <h2 className="font-display text-2xl text-heading">{theme}</h2>
          <Button>Continue</Button> <Badge tone="success">Paid</Badge>
        </section>
      ))}
    </div>
  ),
};
