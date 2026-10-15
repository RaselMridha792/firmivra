'use client';

import {
  Eraser,
  Image as ImageIcon,
  Link as LinkIcon,
  ListBullets,
  ListNumbers,
  Quotes,
  TextB,
  TextItalic,
  TextStrikethrough,
  TextUnderline,
  type Icon,
} from '@phosphor-icons/react';
import { useEffect, useId, useRef, type ClipboardEvent } from 'react';

/** The characters a reader sees: tags dropped, entities counted once, whitespace runs as one. */
export function plainTextLength(html: string): number {
  return html
    .replace(/<(br|\/p|\/h3|\/h4|\/li|\/blockquote)[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z#0-9]+;/gi, '_')
    .replace(/\s+/g, ' ')
    .trim().length;
}

/** Only https links: no javascript: or data: addresses in client-facing text. */
export const HTTPS_LINK = /^https:\/\/\S+$/i;

const BLOCKS = [
  { value: 'p', label: 'Paragraph' },
  { value: 'h3', label: 'Heading' },
  { value: 'h4', label: 'Subheading' },
] as const;

interface Tool {
  label: string;
  icon: Icon;
  command?: string;
  arg?: string;
  special?: 'link' | 'image';
}

/** The toolbar's groups, as in the design: style | B I U | lists | link, image | quote, clear | strike. */
const TOOL_GROUPS: { id: string; tools: Tool[] }[] = [
  {
    id: 'inline',
    tools: [
      { label: 'Bold', icon: TextB, command: 'bold' },
      { label: 'Italic', icon: TextItalic, command: 'italic' },
      { label: 'Underline', icon: TextUnderline, command: 'underline' },
    ],
  },
  {
    id: 'lists',
    tools: [
      { label: 'Bulleted list', icon: ListBullets, command: 'insertUnorderedList' },
      { label: 'Numbered list', icon: ListNumbers, command: 'insertOrderedList' },
    ],
  },
  {
    id: 'insert',
    tools: [
      { label: 'Insert link', icon: LinkIcon, special: 'link' },
      { label: 'Insert image', icon: ImageIcon, special: 'image' },
    ],
  },
  {
    id: 'blocks',
    tools: [
      { label: 'Quote', icon: Quotes, command: 'formatBlock', arg: 'blockquote' },
      { label: 'Clear formatting', icon: Eraser, command: 'removeFormat' },
    ],
  },
  {
    id: 'more',
    tools: [{ label: 'Strikethrough', icon: TextStrikethrough, command: 'strikeThrough' }],
  },
];

export interface RichTextEditorProps {
  label: string;
  /** HTML made only by this toolbar (pasted text arrives as plain text). The API sanitizes again. */
  value: string;
  onChange: (html: string) => void;
  required?: boolean;
  placeholder?: string;
  /** Shows "180/1000" under the box; over the limit it turns red. */
  maxLength?: number;
  hint?: string;
  error?: string;
  /** Asks for a link address (https only); the browser's prompt when left out. */
  onRequestLink?: () => string | null | Promise<string | null>;
  /** Uploads an image and answers its address; the image button is disabled without it. */
  onInsertImage?: () => Promise<string | null>;
  disabled?: boolean;
}

const run = (command: string, arg?: string) => {
  document.execCommand(command, false, arg);
};

/**
 * A formatted-text box: block style, bold, italic, underline, lists, link, image, quote, clear
 * formatting, strikethrough, and a character counter (Services & Pricing' Full Description).
 */
export function RichTextEditor({
  label,
  value,
  onChange,
  required,
  placeholder,
  maxLength,
  hint,
  error,
  onRequestLink,
  onInsertImage,
  disabled,
}: RichTextEditorProps) {
  const id = useId();
  const areaRef = useRef<HTMLDivElement>(null);
  // Only write the value in when it differs, so typing never moves the caret.
  useEffect(() => {
    const el = areaRef.current;
    if (el && el.innerHTML !== value) el.innerHTML = value;
  }, [value]);
  const emit = () => onChange(areaRef.current?.innerHTML ?? '');
  const format = (command: string, arg?: string) => {
    areaRef.current?.focus();
    run(command, arg);
    emit();
  };
  const link = async () => {
    const answer = await (onRequestLink
      ? onRequestLink()
      : window.prompt('Link address (https://)'));
    if (answer && HTTPS_LINK.test(answer.trim())) format('createLink', answer.trim());
  };
  const image = async () => {
    const src = onInsertImage ? await onInsertImage() : null;
    if (src) format('insertImage', src);
  };
  const apply = (tool: Tool) => {
    if (tool.special === 'link') void link();
    else if (tool.special === 'image') void image();
    else if (tool.command) format(tool.command, tool.arg);
  };
  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    run('insertText', event.clipboardData.getData('text/plain'));
    emit();
  };
  const length = plainTextLength(value);
  const over = maxLength !== undefined && length > maxLength;
  const empty = length === 0;
  return (
    <div className="flex flex-col gap-1">
      <span id={`${id}-label`} className="text-sm font-semibold text-heading">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </span>
      <div
        className={`overflow-hidden rounded-control border bg-surface ${error || over ? 'border-danger' : 'border-border'} ${disabled ? 'opacity-50' : ''}`}
      >
        <div
          role="toolbar"
          aria-label={`${label} formatting`}
          className="flex flex-wrap items-center border-b border-border bg-surface"
        >
          <label className="sr-only" htmlFor={`${id}-block`}>
            Text style
          </label>
          <select
            id={`${id}-block`}
            disabled={disabled}
            defaultValue="p"
            onChange={(e) => format('formatBlock', e.target.value)}
            className="min-h-10 border-r border-border bg-transparent px-3 text-sm text-text"
          >
            {BLOCKS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
          {TOOL_GROUPS.map((group) => (
            <div
              key={group.id}
              className="flex items-center border-r border-border px-1 last:border-r-0"
            >
              {group.tools.map((tool) => (
                <button
                  key={tool.label}
                  type="button"
                  title={tool.label}
                  aria-label={tool.label}
                  disabled={disabled || (tool.special === 'image' && !onInsertImage)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => apply(tool)}
                  className="flex size-9 items-center justify-center rounded-md text-text hover:bg-folder-surface disabled:cursor-not-allowed disabled:text-control-border disabled:hover:bg-transparent"
                >
                  <tool.icon aria-hidden weight="bold" className="size-5" />
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="relative">
          {empty && placeholder ? (
            <span
              aria-hidden
              className="pointer-events-none absolute top-3 left-4 text-sm text-muted"
            >
              {placeholder}
            </span>
          ) : null}
          <div
            ref={areaRef}
            role="textbox"
            aria-multiline="true"
            aria-labelledby={`${id}-label`}
            aria-required={required}
            aria-invalid={!!error || over}
            aria-describedby={error || hint ? `${id}-help` : undefined}
            contentEditable={!disabled}
            suppressContentEditableWarning
            onInput={emit}
            onPaste={paste}
            className="min-h-32 px-4 py-3 text-sm text-text focus:outline-none [&_a]:text-link [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_h3]:text-lg [&_h3]:font-bold [&_h4]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
          />
        </div>
      </div>
      <div className="flex justify-between gap-4 text-xs">
        <span id={`${id}-help`} className={error ? 'text-danger' : 'text-muted'}>
          {error ?? hint}
        </span>
        {maxLength !== undefined ? (
          <span className={`tabular-nums ${over ? 'text-danger' : 'text-muted'}`}>
            {length}/{maxLength}
          </span>
        ) : null}
      </div>
    </div>
  );
}
