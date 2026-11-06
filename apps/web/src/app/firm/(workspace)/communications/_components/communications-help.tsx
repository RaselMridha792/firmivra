'use client';

import { HelpTip } from '@firmivra/ui';

// Octavia's Oct 28 Communications review (the change list's Help icons, as in TP-F02 and RP-F22):
// one Help icon per functional area, with its text in this one file. Each says what the area is
// for, what it needs, its limits and what happens.

const HELP = {
  overview: {
    topic: 'Communications',
    text: 'Bulk emails, text messages and portal announcements to many clients and leads at once; one-to-one conversations are in Messages. The cards count what was sent and open Sent History, and each tab lists one kind.',
  },
  start: {
    topic: 'Starting a communication',
    text: 'Email, Text and Announcement each start a draft that you write, address and review. Choose Recipients starts one with its audience chooser open. Nothing is sent until you confirm in Review & Send.',
  },
  recent: {
    topic: 'Recent communications',
    text: 'The latest communications with their kind, audience and status. Open one to see its results, or a draft to keep writing it. View All opens Sent History.',
  },
  upcoming: {
    topic: 'Upcoming communications',
    text: 'What is scheduled to go out, and when. A scheduled one can be rescheduled, paused or cancelled before it goes; consent is checked again when it is sent.',
  },
  templates: {
    topic: 'Saved templates',
    text: 'Active email, text and announcement templates you may use, from Templates. Use Template starts a draft copied from one; later changes to the template do not change that draft. A draft template is not offered until it is active.',
  },
  reach: {
    topic: 'Segments and lists',
    text: 'A segment follows rules and updates itself; a list holds the people you pick. Build them under Segments & Lists, then choose them in Choose Recipients on a draft.',
  },
  list: {
    topic: 'Lists and search',
    text: 'Search finds communications by name or subject. The row menu reschedules, pauses, cancels, duplicates, saves as a template or archives, as its status allows. Archived ones keep their results and can be restored.',
  },
  segments: {
    topic: 'Managing segments and lists',
    text: 'Owner shows who made each one and Last Refreshed when its rules or people last changed. A segment matches all or any of its rules, with a live count before you save; a list’s people are added and removed by hand. Archiving one never changes a communication already sent.',
  },
  composer: {
    topic: 'Writing a communication',
    text: 'Save Draft keeps your work, and the time it was last saved is shown. Back, the breadcrumb and Cancel ask before unsaved changes are lost. Review & Send checks everything before anything goes out.',
  },
  channel: {
    topic: 'Communication type',
    text: 'Email goes to email addresses, Text to mobile numbers with consent, and Announcement shows in the client portal for its window. Text is plain text; Email and Announcement take formatting, images and five fonts.',
  },
  recipients: {
    topic: 'Recipients',
    text: 'Choose segments, lists and single clients or leads, and leave anyone out. Only people who can receive this type count: an email address with no opt-out, a mobile number with consent for texts, or a portal login for an announcement.',
  },
  message: {
    topic: 'Message and personalization',
    text: 'A personalization field such as [Client First Name] is filled in for each person when it is sent; an unknown field is flagged and blocks sending. Insert Closing adds your firm’s or your own signature at the end. A text is split into parts of 160 characters.',
  },
  window: {
    topic: 'Announcement window',
    text: 'The announcement shows in the client portal from Show From until Show Until, in the place you choose under Where. The end must come after the start, and a window that has ended cannot be published.',
  },
  attachments: {
    topic: 'Attachments',
    text: 'Files added to an email or an announcement, kept for your firm only. Texts carry no files.',
  },
  delivery: {
    topic: 'Delivery',
    text: 'Send Now sends right after Review & Send; Schedule for Later sends at the date and time you choose. A time that has passed cannot be scheduled.',
  },
  template: {
    topic: 'Template',
    text: 'Use Template copies an active template into this draft; your edits here do not change the template. Save as Template keeps this message as a template for next time.',
  },
  preview: {
    topic: 'Message preview',
    text: 'Shows the saved draft as a recipient sees it, on a computer or a phone; save to see your latest changes. Nothing is sent from the preview.',
  },
  checklist: {
    topic: 'Pre-send checklist',
    text: 'What must be right before sending: a ready sender, at least one eligible recipient, a subject or title, the message, known fields and a valid time. A red item blocks sending until it is fixed.',
  },
  review: {
    topic: 'Review & Send',
    text: 'One last look at the type, sender, audience and message. A red check blocks sending until it is fixed. It goes to the number shown; if that number changes before you confirm, nothing is sent and you review it again.',
  },
  audience: {
    topic: 'Choosing the audience',
    text: 'Pick segments, lists or single contacts, then leave out anyone who should not get it. Someone in two choices is counted once.',
  },
  total: {
    topic: 'Recipient total',
    text: 'How many will receive it, and how many are left out and why: no address or number, an opt-out, no consent for texts, or excluded by you. Consent is checked again when it goes out.',
  },
  results: {
    topic: 'Results',
    text: 'What happened to this communication: how many were sent, delivered, opened and clicked, and who failed. The message itself never changes after it is sent.',
  },
  performance: {
    topic: 'Performance and delivery',
    text: 'Each bar counts people at that step out of everyone it was sent to. Opens and clicks are counted when the provider reports them, so some people who read it may not show as opened.',
  },
  actions: {
    topic: 'Actions',
    text: 'Duplicate and Send Follow-Up each make a new draft (a follow-up for those who opened, did not open, clicked, did not click or failed); the original stays as it was. Save as Template keeps the message; Archive hides it from the lists.',
  },
  activity: {
    topic: 'Recipient activity',
    text: 'Each person it went to, with what happened: delivered, opened, clicked or failed, and why it failed. Open a client to see their record.',
  },
} as const;

export type CommunicationsHelpArea = keyof typeof HELP;

/** The Help icon of one Communications area (hover, keyboard focus or a tap). */
export function CommsHelp({ area }: { area: CommunicationsHelpArea }) {
  const h = HELP[area];
  return <HelpTip topic={h.topic}>{h.text}</HelpTip>;
}
