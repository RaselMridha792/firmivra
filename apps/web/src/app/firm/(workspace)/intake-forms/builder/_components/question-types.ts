import type { QuestionType } from '@firmivra/types';
import {
  CalendarDots,
  CaretCircleDown,
  CheckSquare,
  CloudArrowUp,
  CurrencyDollar,
  Envelope,
  Hash,
  type Icon,
  PencilLine,
  Phone,
  RadioButton,
  SquareSplitVertical,
  TextAa,
  TextAlignLeft,
  TextT,
  ToggleLeft,
} from '@phosphor-icons/react';

export interface QuestionLook {
  label: string;
  icon: Icon;
}

/**
 * Each question type's name and icon, as Add Questions draws them (create-new-intake-form.jpg).
 * Not exact: Paragraph (the design's lines start with a dot), Dropdown (the design's caret sits in
 * a square; Phosphor has it only in a circle).
 */
export const QUESTION_LOOKS: Record<QuestionType, QuestionLook> = {
  SHORT_ANSWER: { label: 'Short Answer', icon: TextAa },
  PARAGRAPH: { label: 'Paragraph', icon: TextAlignLeft },
  MULTIPLE_CHOICE: { label: 'Multiple Choice', icon: RadioButton },
  CHECKBOXES: { label: 'Checkboxes', icon: CheckSquare },
  DROPDOWN: { label: 'Dropdown', icon: CaretCircleDown },
  DATE: { label: 'Date Picker', icon: CalendarDots },
  FILE_UPLOAD: { label: 'File Upload', icon: CloudArrowUp },
  NUMBER: { label: 'Number', icon: Hash },
  CURRENCY: { label: 'Currency', icon: CurrencyDollar },
  EMAIL: { label: 'Email', icon: Envelope },
  PHONE: { label: 'Phone', icon: Phone },
  YES_NO: { label: 'Yes / No', icon: ToggleLeft },
  SIGNATURE: { label: 'Signature', icon: PencilLine },
  SECTION_BREAK: { label: 'Section Break', icon: SquareSplitVertical },
  INSTRUCTION_TEXT: { label: 'Instruction Text', icon: TextT },
};

/**
 * The tiles of Add Questions, in the design's order. Currency has no tile of its own (guide
 * Frame 1: "the tile is labeled Number"); a Number question switches to Currency in its editor.
 */
export const PALETTE: QuestionType[] = [
  'SHORT_ANSWER',
  'PARAGRAPH',
  'MULTIPLE_CHOICE',
  'CHECKBOXES',
  'DROPDOWN',
  'DATE',
  'FILE_UPLOAD',
  'NUMBER',
  'EMAIL',
  'PHONE',
  'YES_NO',
  'SIGNATURE',
  'SECTION_BREAK',
  'INSTRUCTION_TEXT',
];

/** The label a new question of the type starts with. */
export const NEW_LABEL: Record<QuestionType, string> = {
  SHORT_ANSWER: 'New question',
  PARAGRAPH: 'New question',
  MULTIPLE_CHOICE: 'Choose one',
  CHECKBOXES: 'Choose all that apply',
  DROPDOWN: 'Choose one',
  DATE: 'Date',
  FILE_UPLOAD: 'Upload a document',
  NUMBER: 'Amount',
  CURRENCY: 'Amount',
  EMAIL: 'Email address',
  PHONE: 'Phone number',
  YES_NO: 'Yes or no?',
  SIGNATURE: 'Signature',
  SECTION_BREAK: 'New part',
  INSTRUCTION_TEXT: 'Instructions for the client',
};

/** The drag payload type for a question tile. */
export const TILE_DRAG = 'application/x-firmivra-question-type';
