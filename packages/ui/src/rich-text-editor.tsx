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
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  TextStrikethrough,
  TextUnderline,
  Trash,
  type Icon,
} from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState, type ClipboardEvent, type MouseEvent } from 'react';

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
  /** A Font menu (label, CSS font-family) that styles the selected text or what is typed next. */
  fonts?: readonly { label: string; stack: string }[];
  /** A Size menu, in pixels, that sizes the selected text or what is typed next. */
  fontSizes?: readonly number[];
  /** A clicked image can be resized within these widths and placed left, centre or right. */
  imageSizing?: { minWidth: number; maxWidth: number };
  /** Leaves out the link button, for text whose links are not kept (a lead email). */
  noLinks?: boolean;
}

const run = (command: string, arg?: string) => {
  document.execCommand(command, false, arg);
};

/**
 * How the browser marks the selected runs before they become styled spans: a font face for a
 * font, the largest font size for a size (each command clears only its own property inside).
 */
const MARKS = {
  fontFamily: { command: 'fontName', arg: 'fv-mark', selector: 'font[face="fv-mark"]' },
  fontSize: { command: 'fontSize', arg: '7', selector: 'font[size="7"]' },
} as const;
const ZERO_WIDTH = '\u200B';

/**
 * Styles the selection inside `area` with one CSS property: the browser's font command marks the
 * selected runs with <font>, which become spans with the style (inner spans give theirs up).
 * At a caret, an empty styled span takes what is typed next.
 */
function styleSelection(area: HTMLElement, property: 'fontFamily' | 'fontSize', value: string) {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!selection || !range || !area.contains(range.commonAncestorContainer)) return;
  const styled = () => {
    const span = document.createElement('span');
    span.style[property] = value;
    return span;
  };
  if (range.collapsed) {
    const span = styled();
    const text = document.createTextNode(ZERO_WIDTH);
    span.append(text);
    range.insertNode(span);
    const caret = document.createRange();
    caret.setStart(text, 1);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
    return;
  }
  const mark = MARKS[property];
  run('styleWithCSS', 'false');
  run(mark.command, mark.arg);
  const spans = [...area.querySelectorAll(mark.selector)].map((font) => {
    const span = styled();
    span.append(...font.childNodes);
    span.querySelectorAll('span').forEach((inner) => {
      inner.style[property] = '';
    });
    font.replaceWith(span);
    return span;
  });
  const first = spans[0];
  const last = spans.at(-1);
  if (first && last) {
    const again = document.createRange();
    again.setStartBefore(first);
    again.setEndAfter(last);
    selection.removeAllRanges();
    selection.addRange(again);
  }
}

const BLOCK = 'p,div,h3,h4,li,blockquote';
const ALIGNMENTS = [
  { value: 'left', label: 'Place image left', icon: TextAlignLeft },
  { value: 'center', label: 'Place image in the centre', icon: TextAlignCenter },
  { value: 'right', label: 'Place image right', icon: TextAlignRight },
] as const;

/**
 * The image's own line, so placing it never moves the text: its block when that holds only the
 * image, otherwise a new paragraph (after the block, or around the image when it has none).
 */
function blockOf(image: HTMLImageElement, area: HTMLElement): HTMLElement {
  const found = image.parentElement?.closest<HTMLElement>(BLOCK);
  const block = found && found !== area && area.contains(found) ? found : null;
  if (block && block.textContent?.trim() === '' && block.querySelectorAll('img').length === 1)
    return block;
  const p = document.createElement('p');
  if (block) block.after(p);
  else image.replaceWith(p);
  p.append(image);
  return p;
}

/** The width an inserted image starts at: its own, within the limits (300 px until it loads). */
function startWidth(src: string, sizing: { minWidth: number; maxWidth: number }) {
  return new Promise<number>((resolve) => {
    const probe = new Image();
    const fit = (w: number) => Math.min(sizing.maxWidth, Math.max(sizing.minWidth, w));
    probe.onload = () => resolve(fit(probe.naturalWidth || 300));
    probe.onerror = () => resolve(fit(300));
    probe.src = src;
  });
}

const escapeAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * A formatted-text box: block style, bold, italic, underline, lists, link, image, quote, clear
 * formatting, strikethrough, and a character counter (Services & Pricing' Full Description).
 * Opt-in for an email (the lead email composer): fonts, sizes, and images resized and placed.
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
  fonts,
  fontSizes,
  imageSizing,
  noLinks,
}: RichTextEditorProps) {
  const id = useId();
  const areaRef = useRef<HTMLDivElement>(null);
  // The clicked image (an element in the box), and its width while one is picked.
  const pickedRef = useRef<HTMLImageElement | null>(null);
  const [pickedWidth, setPickedWidth] = useState<number | null>(null);
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
    if (!src) return;
    if (!imageSizing) {
      format('insertImage', src);
      return;
    }
    const width = await startWidth(src, imageSizing);
    format('insertHTML', `<img src="${escapeAttr(src)}" alt="" style="width: ${width}px;">`);
  };
  const style = (property: 'fontFamily' | 'fontSize', value: string) => {
    const area = areaRef.current;
    if (!area || !value) return;
    area.focus();
    styleSelection(area, property, value);
    emit();
  };
  const pick = (event: MouseEvent<HTMLDivElement>) => {
    if (!imageSizing) return;
    const target = event.target;
    pickedRef.current = target instanceof HTMLImageElement ? target : null;
    setPickedWidth(
      target instanceof HTMLImageElement
        ? Math.round(target.getBoundingClientRect().width) || imageSizing.minWidth
        : null,
    );
  };
  const pickedImage = () => {
    const picked = pickedRef.current;
    return picked && areaRef.current?.contains(picked) ? picked : null;
  };
  const input = () => {
    // The picked image was deleted from the keyboard: its controls go too.
    if (pickedRef.current && !pickedImage()) {
      pickedRef.current = null;
      setPickedWidth(null);
    }
    emit();
  };
  const resize = (width: number) => {
    const picked = pickedImage();
    if (!picked) return;
    picked.style.width = `${width}px`;
    picked.removeAttribute('width');
    picked.removeAttribute('height');
    setPickedWidth(width);
    emit();
  };
  const place = (align: 'left' | 'center' | 'right') => {
    const area = areaRef.current;
    const picked = pickedImage();
    if (!picked || !area) return;
    blockOf(picked, area).style.textAlign = align;
    emit();
  };
  const removePicked = () => {
    pickedImage()?.remove();
    pickedRef.current = null;
    setPickedWidth(null);
    emit();
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
          {fonts ? (
            <>
              <label className="sr-only" htmlFor={`${id}-font`}>
                Font
              </label>
              <select
                id={`${id}-font`}
                disabled={disabled}
                value=""
                onChange={(e) => style('fontFamily', e.target.value)}
                className="min-h-10 border-r border-border bg-transparent px-3 text-sm text-text"
              >
                <option value="">Font</option>
                {fonts.map((f) => (
                  <option key={f.label} value={f.stack}>
                    {f.label}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          {fontSizes ? (
            <>
              <label className="sr-only" htmlFor={`${id}-size`}>
                Size
              </label>
              <select
                id={`${id}-size`}
                disabled={disabled}
                value=""
                onChange={(e) => style('fontSize', e.target.value ? `${e.target.value}px` : '')}
                className="min-h-10 border-r border-border bg-transparent px-3 text-sm text-text"
              >
                <option value="">Size</option>
                {fontSizes.map((size) => (
                  <option key={size} value={size}>
                    {size} px
                  </option>
                ))}
              </select>
            </>
          ) : null}
          {TOOL_GROUPS.map((group) => (
            <div
              key={group.id}
              className="flex items-center border-r border-border px-1 last:border-r-0"
            >
              {group.tools
                .filter((tool) => !(noLinks && tool.special === 'link'))
                .map((tool) => (
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
        {pickedWidth !== null && imageSizing ? (
          <div
            role="group"
            aria-label="Selected image"
            className="flex flex-wrap items-center gap-3 border-b border-border bg-canvas px-3 py-2 text-sm"
          >
            <label htmlFor={`${id}-width`} className="font-semibold text-heading">
              Image width
            </label>
            <input
              id={`${id}-width`}
              type="range"
              min={imageSizing.minWidth}
              max={imageSizing.maxWidth}
              step={4}
              value={pickedWidth}
              onChange={(e) => resize(Number(e.target.value))}
              className="w-40 accent-action"
            />
            <span className="tabular-nums text-text">{pickedWidth} px</span>
            <div className="flex items-center">
              {ALIGNMENTS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  title={a.label}
                  aria-label={a.label}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => place(a.value)}
                  className="flex size-9 items-center justify-center rounded-md text-text hover:bg-folder-surface"
                >
                  <a.icon aria-hidden weight="bold" className="size-5" />
                </button>
              ))}
              <button
                type="button"
                title="Remove image"
                aria-label="Remove image"
                onMouseDown={(e) => e.preventDefault()}
                onClick={removePicked}
                className="flex size-9 items-center justify-center rounded-md text-danger hover:bg-folder-surface"
              >
                <Trash aria-hidden weight="bold" className="size-5" />
              </button>
            </div>
          </div>
        ) : null}
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
            onInput={input}
            onPaste={paste}
            onClick={pick}
            className="min-h-32 px-4 py-3 text-sm text-text focus:outline-none [&_a]:text-link [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_h3]:text-lg [&_h3]:font-bold [&_h4]:font-semibold [&_img]:inline-block [&_img]:max-w-full [&_img]:cursor-pointer [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
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
