import type { LucideIcon } from 'lucide-react';

// How each form's panels sit in its mockups (docs/mockups/begin-online/): which sections share a
// panel, its icon and width, and the rows its fields make. Only the look: the definition
// (packages/types) still decides the fields, their checks and what is shown. A section a form
// doesn't list keeps the defaults: half the step's width, one field per row.
//
// A row is a string of cells, "key" or "key:span" with the span in twelfths (a row's cells share
// the twelve evenly when no span is given). A name is the cell `name` (`spouseName` for the
// `spouse` prefix: first, middle and last on one line); an address is `address`
// (`spouseAddress`...: the street, then city, state and ZIP on the next line).

/** A grid as its mockup draws it: an icon per row, and quarter columns in their own tints. */
export interface GridLook {
  icons?: Record<string, LucideIcon>;
  /** Each amount column tinted, with a calendar icon and "Enter amount" under its name. */
  tones?: boolean;
}

export interface RowsLook {
  rows?: string[];
  /** Side-by-side columns, each with its width in twelfths and its own rows. */
  columns?: { span: number; rows: string[] }[];
  /** Labels for name and address cells, by cell key (default "Full Name" / the street's label). */
  labels?: Record<string, string>;
  /** Fields with their label on the left of a one-line input. */
  inline?: string[];
  /** Fields in a tinted box with an icon (Annual's "Type of Tax Return(s) You Need"). */
  boxed?: Record<string, LucideIcon>;
  /** Yes/No questions one per line: the question, then Yes and No at the line's end. */
  yesNoList?: boolean;
  /** City, State and ZIP keep their labels (otherwise their placeholders name them). */
  addressLabels?: boolean;
  /** Choices set out in this many columns, by field key. */
  optionColumns?: Record<string, 1 | 2 | 3 | 4>;
  /** Fields whose label only screen readers hear (the panel's title and subtitle say it). */
  quiet?: string[];
  /** Upload zones drawn as "Drag and drop your files here / or / Choose Files". */
  chooser?: boolean;
  /** Grids by field key. */
  grids?: Record<string, GridLook>;
  /** A group drawn as a table: a column per field, a line per row. */
  table?: boolean;
  /** Notes drawn as a box: the icon and the bold title, the text under it. */
  noteCards?: string[];
  /** Package cards' icons, by option value. */
  cardIcons?: Record<string, LucideIcon>;
  /** Uploads drawn as cards with this icon, by field key. */
  uploadCards?: Record<string, LucideIcon>;
  /** Upload cards drawn wide and warm: the text left, the drop zone right. */
  uploadWide?: string[];
  /** Tick boxes drawn as a red-edged box ("I don't have my inventory organized yet."). */
  alerts?: string[];
  /** A group: a lone row without its "Business 1" heading box (rows get one from the second). */
  bare?: boolean;
}

export interface PanelLook extends RowsLook {
  icon?: LucideIcon;
  /** The icon before the title instead of at the panel's right edge. */
  iconFirst?: boolean;
  /** Both columns of the step. */
  wide?: boolean;
  /** Later sections drawn in this panel, each under its own heading. */
  join?: string[];
  /** The panel's title and subtitle when they are not its first section's. */
  title?: string;
  subtitle?: string;
  /** Icons of the joined sections' headings, by section key. */
  joinIcons?: Record<string, LucideIcon>;
  /** No number: the title on the left and the fields on the right, in one tinted bar. */
  bar?: boolean;
  /** No title at all (a certification box). */
  headless?: boolean;
  /** The step's heading: a large unnumbered title with the step's subtitle under it. */
  intro?: boolean;
  /** An icon in the number's circle instead of the number. */
  badge?: LucideIcon;
  /** Upload slots side by side, one tile each. */
  tiles?: boolean;
  /** A tinted panel (the payment choice). */
  tint?: boolean;
  /** No number (a panel the mockup leaves unnumbered among numbered ones). */
  noNumber?: boolean;
  /** The previous panel's number again (the mockup numbers two panels alike). */
  shareNumber?: boolean;
  /** No box: a large heading on the page with the fields under it. */
  plain?: boolean;
  /** A note field shown as a box above the panel instead of inside it. */
  lead?: string;
  /** A tinted panel with a matching edge. */
  tone?: 'danger' | 'warm';
  /** Its number written into its title ("1. Business Accounts") instead of in a circle. */
  numberInTitle?: boolean;
  /** The edge icon's colour: the heading's navy or the danger red (otherwise the accent). */
  iconTone?: 'heading' | 'danger';
  /** The badge circle navy with a white icon (otherwise the accent). */
  badgeDark?: boolean;
  /** A group field's rows, by the group's key. */
  groups?: Record<string, RowsLook>;
}

/** How the review step draws the answers. */
export interface ReviewLook {
  /** One card per step, its answers as "Label: answer" lines, instead of one per panel. */
  byStep?: boolean;
  /** Cards under a coloured title band, in turn navy, accent and blue. */
  banded?: boolean;
  /** The cards on the left; the files, the review step's own panels and the agreement right. */
  aside?: boolean;
  /** The answers, the files and the step's own panels on the left; the agreement right. */
  agreementRight?: boolean;
  /** Each step as a row that opens to its answers, with a line saying what it holds. */
  collapsed?: boolean;
  /** The line under each step's row, by step key. */
  notes?: Record<string, string>;
  /** Steps the review leaves out (their files are listed on their own). */
  skipSteps?: string[];
  /** The review's own panels' titles, numbered with the agreement's (Bookkeeping). */
  titles?: { answers: string; answersNote: string; files?: string; filesNote?: string };
  /** The cards' icons, by step key. */
  icons?: Record<string, LucideIcon>;
}

export interface FormLook {
  panels: Record<string, PanelLook>;
  /** An info field shown in the bar beside Continue instead of in its panel. */
  footerNote?: string;
  /** The review opens with its own "Review Your Information" heading. */
  reviewHeading?: boolean;
  review?: ReviewLook;
  /** The form's title on two lines: its last two words (in the accent colour) under the rest. */
  titleBreak?: boolean;
  /** A line under each step's name in the stepper, by step key (the step's subtitle then shows
   * nowhere else). */
  stepperHints?: Record<string, string>;
  /**
   * Panels in independent columns, each a list of panel keys, where the mockup does not line them
   * up in rows. `stretch` makes a row's columns as tall as each other.
   */
  stacks?: { columns: string[][]; stretch?: boolean }[];
  /** Steps that open with a navy band: the step's number, title and subtitle. */
  banners?: string[];
  /** The agreement panel's title ("4. Review & Sign Our Agreement"). */
  agreementTitle?: string;
}

export const NO_LOOK: FormLook = { panels: {} };

/**
 * Which of a two-column list's items take the whole row: the wide ones, and a half-width one left
 * alone in its row (the next is wide, or there is none), so no hole is left beside it.
 */
export function fullRows(wide: boolean[]): boolean[] {
  const out: boolean[] = [];
  let open = false;
  wide.forEach((w, i) => {
    if (w || wide.length === 1) {
      out.push(true);
      open = false;
    } else if (open) {
      out.push(false);
      open = false;
    } else {
      const alone = i === wide.length - 1 || wide[i + 1] === true;
      out.push(alone);
      open = !alone;
    }
  });
  return out;
}

/** The span classes a row's cells use (whole classes, so Tailwind finds them). */
export const SPAN: Record<number, string> = {
  1: 'sm:col-span-1',
  2: 'sm:col-span-2',
  3: 'sm:col-span-3',
  4: 'sm:col-span-4',
  5: 'sm:col-span-5',
  6: 'sm:col-span-6',
  7: 'sm:col-span-7',
  8: 'sm:col-span-8',
  9: 'sm:col-span-9',
  10: 'sm:col-span-10',
  11: 'sm:col-span-11',
  12: 'sm:col-span-12',
};
