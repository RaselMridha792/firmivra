export interface CreateTemplateMock {
  name: string;
  category: string;
  subject: string;
  body: string;
  previewName: string;
  previewEmail: string;
}

export interface TemplateMergeFieldMock {
  token: string;
  label: string;
}

export interface TemplateLibraryImageMock {
  id: string;
  name: string;
  kind: 'brand' | 'workspace' | 'plant' | 'welcome';
}

export function createTemplateMock(): CreateTemplateMock {
  return {
    name: 'Client Onboarding – Welcome',
    category: 'Onboarding',
    subject: 'Welcome to Firmivra!',
    body: [
      '<p>Hi {{contact_name}},</p>',
      '<p>Welcome to Firmivra! We’re excited to have you on board.</p>',
      '<p>Our team is here to help you get started. If you have any questions, reach out to your dedicated contact.</p>',
      '<p>Best regards,<br />{{firm_name}}<br />The Firmivra Team</p>',
    ].join(''),
    previewName: 'John Doe',
    previewEmail: 'john.doe@example.test',
  };
}

export function getTemplateCategoryOptions(): readonly string[] {
  return ['Onboarding', 'Sales', 'Support', 'Billing', 'Firm Applications', 'System Notices'];
}

export function getTemplateMergeFields(): TemplateMergeFieldMock[] {
  return [
    { token: '{{firm_name}}', label: 'Firm Name' },
    { token: '{{contact_email}}', label: 'Contact Email' },
    { token: '{{contact_name}}', label: 'Contact Name' },
    { token: '{{phone_number}}', label: 'Phone Number' },
    { token: '{{first_name}}', label: 'First Name' },
    { token: '{{application_name}}', label: 'Application Name' },
    { token: '{{last_name}}', label: 'Last Name' },
    { token: '{{application_status}}', label: 'Application Status' },
    { token: '{{firm_owner}}', label: 'Firm Owner' },
    { token: '{{next_steps}}', label: 'Next Steps' },
    { token: '{{support_email}}', label: 'Support Email' },
    { token: '{{current_date}}', label: 'Current Date' },
    { token: '{{login_link}}', label: 'Login Link' },
    { token: '{{custom_message}}', label: 'Custom Message' },
  ];
}

export function getTemplateLibraryImages(): TemplateLibraryImageMock[] {
  return [
    { id: 'firmivra', name: 'Firmivra', kind: 'brand' },
    { id: 'workspace', name: 'Workspace', kind: 'workspace' },
    { id: 'plant', name: 'Plant', kind: 'plant' },
    { id: 'welcome', name: 'Welcome', kind: 'welcome' },
  ];
}
