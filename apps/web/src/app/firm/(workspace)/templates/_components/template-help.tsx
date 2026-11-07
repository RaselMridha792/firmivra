'use client';

import { HelpTip } from '@firmivra/ui';

// TP-F02 (Octavia's Oct 28 Templates review): one Help icon per functional area, with its text in
// this one file. Each says what the area is for, what it needs, its limits and what happens.

const HELP = {
  overview: {
    topic: 'Templates',
    text: 'Reusable emails, texts, letters, checklists and more for your firm. Use starts a message or a module’s own task, request or form from an active template; a draft or an archived one cannot be used. Editing a template never changes what was already sent.',
  },
  views: {
    topic: 'Views and template kinds',
    text: 'My Templates are the ones you own, Shared with Me are others’ you may use, and Favorites are the ones you starred. Category and Search narrow the list. Each card opens the library of one kind, with how many of them you can see.',
  },
  recent: {
    topic: 'Recent templates',
    text: 'The templates changed most recently, with their category and who changed them. Use is switched off for a draft or an archived template and says why.',
  },
  tools: {
    topic: 'Template tools',
    text: 'Create starts a blank template and Import turns pasted HTML or text into a private draft. Merge Fields lists what can be filled in, Branding & Letterhead sets your footer and signature, and Template Categories manages the categories of each kind.',
  },
  library: {
    topic: 'Template library',
    text: 'Every template of this kind that you can see. Edit opens it, Preview shows it with sample data, and Use starts it where it is used. Drafts and archived templates stay listed but cannot be used; Restore brings an archived one back.',
  },
  filters: {
    topic: 'Search and filters',
    text: 'Search looks in names, descriptions and subject lines, and matches a whole tag. Status, Owner, Tag and Sort narrow and order the list; Non-archived shows active templates and drafts. The list is kept as you left it when you come back from a template.',
  },
  categories: {
    topic: 'Categories',
    text: 'Categories group the templates of this kind. The heading counts the categories; All Categories counts every template, and Uncategorized lists those in none. Add New Category or Template Categories adds, renames, reorders, merges and archives them.',
  },
  details: {
    topic: 'Writing a template',
    text: 'A name (up to 200 characters) and the content are needed; an email also needs a subject line before it is active. Save as Draft keeps it to finish later. Only an Owner or Admin makes a template Active, and only an active one can be used.',
  },
  preview: {
    topic: 'Preview and Test Send',
    text: 'Preview fills the merge fields with sample data, including your unsaved changes, and sends nothing. Test Send sends the saved template to the address or number you enter; it never changes the template. Save the template first.',
  },
  mergeFields: {
    topic: 'Merge fields',
    text: 'Choose a field to put it where your cursor is, in the subject line or the content. It is filled in from the client, firm, appointment, invoice, tax or staff record when the template is used. An unknown field is flagged and is not filled in.',
  },
  structure: {
    topic: 'Structure',
    text: 'A Task, Document Request or Intake template stands for that module’s own template, and Use starts from it. Tax Workflow and Bookkeeping templates keep their steps here for reference; those modules cannot start from a template yet.',
  },
  attachments: {
    topic: 'Attachments',
    text: 'Up to 10 files of at most 10 MB each: PDF, Word, Excel, JPG or PNG. Save the template first. Files are kept with the template, for your firm only, and each one can be downloaded to check it.',
  },
  access: {
    topic: 'Who can use it',
    text: 'Only me keeps the template to you, All Team Members lets everyone in your firm use it, and Selected people shares it with the members you tick. Favorites are yours alone.',
  },
  automations: {
    // Not the checkbox's own words, so its label finds only the checkbox.
    topic: 'Automations',
    text: 'Lets automations send this template; only an active one is offered to them. Saving or archiving a template an automation uses asks first, since it changes what that automation sends.',
  },
  versions: {
    topic: 'Version history',
    text: 'Each save keeps a version, with who saved it and when. Restore brings an earlier version back; what was already sent stays as it was.',
  },
  import: {
    topic: 'Importing a template',
    text: 'Paste HTML or plain text, or choose a Word document (.docx, up to 10 MB) for an email, letter or other formatted kind; a text message takes plain text only. Scripts, a Word document’s images and other unsafe parts are removed, and the document is not kept. It becomes a private draft (Only me, automations off) that you can edit and activate.',
  },
  branding: {
    topic: 'Branding & Letterhead',
    text: 'The footer, disclaimer and signature added to client messages, and whether letters use your letterhead. Your logo and business name come from Settings. Messages already sent keep what they had.',
  },
  categoryTools: {
    topic: 'Managing categories',
    text: 'Choose a kind, then add, rename, reorder or archive its categories. Merge moves every template of one category into another and archives the first. Template names and content stay as they are.',
  },
} as const;

export type TemplateHelpArea = keyof typeof HELP;

/** The Help icon of one Templates area (hover, keyboard focus or a tap). */
export function TemplateHelp({ area }: { area: TemplateHelpArea }) {
  const h = HELP[area];
  return <HelpTip topic={h.topic}>{h.text}</HelpTip>;
}
