import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileDropzone } from './index';

const meta = {
  title: 'Firm Backend/FileDropzone',
  component: FileDropzone,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof FileDropzone>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Staff Documents. */
export const Default: Story = {
  args: {
    label: 'Staff documents',
    onFiles: () => {},
    accept: ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'],
    maxBytes: 10 * 1024 * 1024,
    hints: ['Accepted formats: PDF, JPG, PNG, DOC, DOCX', 'Max size: 10MB per file'],
  },
  render: (args) => (
    <div className="max-w-sm">
      <FileDropzone {...args} />
    </div>
  ),
};

/** Settings' Login Background Image. */
export const Image: Story = {
  args: {
    label: 'Login background image',
    onFiles: () => {},
    icon: 'image',
    title: 'Drag & drop or click to upload',
    multiple: false,
    accept: ['image/png', 'image/jpeg', 'image/webp'],
    hints: ['Recommended: 1920 x 1080 px'],
  },
  render: (args) => (
    <div className="max-w-xs">
      <FileDropzone {...args} />
    </div>
  ),
};

/** No hints, nothing chosen yet. */
export const Empty: Story = {
  args: { label: 'Files', onFiles: () => {} },
  render: (args) => (
    <div className="max-w-sm">
      <FileDropzone {...args} />
    </div>
  ),
};

export const LongText: Story = {
  args: {
    label: 'Supporting documents',
    onFiles: () => {},
    title:
      'Drag & drop employment agreements, W-4 forms and direct deposit forms here or click to upload',
    hints: [
      'Accepted formats: PDF, JPG, PNG, DOC, DOCX, and scanned images from a phone camera',
      'Max size: 10MB per file, up to 20 files at once',
    ],
  },
  render: (args) => (
    <div className="max-w-sm">
      <FileDropzone {...args} />
    </div>
  ),
};
