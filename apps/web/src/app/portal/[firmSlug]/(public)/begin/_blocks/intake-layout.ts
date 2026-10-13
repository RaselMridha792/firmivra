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
  /** A group field's rows, by the group's key. */
  groups?: Record<string, RowsLook>;
}

export interface FormLook {
  panels: Record<string, PanelLook>;
  /** An info field shown in the bar beside Continue instead of in its panel. */
  footerNote?: string;
}

export const NO_LOOK: FormLook = { panels: {} };

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
