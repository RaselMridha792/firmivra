'use client';

import type { IntakeField, IntakeSection, IntakeStep } from '@firmivra/types';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { SectionPanel } from './form-blocks';
import { type Fill, InfoNote, ScalarInput, splitBracket } from './intake-fields';
import { GridInput } from './intake-grid';
import { GroupInput } from './intake-group';
import { type FormLook, fullRows, NO_LOOK, type PanelLook, type RowsLook } from './intake-layout';
import { type FieldLook, FieldRows } from './intake-rows';
import { type UploadActions, UploadInput } from './intake-upload';
import {
  issueKey,
  type ScreenGrid,
  type ScreenRow,
  type ScreenScalar,
  type ScreenUpload,
  type ScreenValue,
  type ScreenValues,
} from './intake-values';

/** A field that takes the panel's whole width. */
function wideField(f: IntakeField): boolean {
  switch (f.type) {
    case 'textarea':
    case 'grid':
    case 'group':
    case 'upload':
    case 'info':
    case 'checkboxes':
      return true;
    case 'radio':
      return f.display === 'cards' || f.options.length > 3;
    case 'state':
      return f.multiple;
    default:
      return false;
  }
}

/** A panel that takes both columns of the step: tables, repeating rows, cards, long lists. */
function wideSection(section: IntakeSection): boolean {
  return (
    section.fields.length > 10 ||
    section.fields.some(
      (f) =>
        f.type === 'grid' ||
        f.type === 'group' ||
        f.type === 'upload' ||
        (f.type === 'radio' && f.display === 'cards') ||
        (f.type === 'checkboxes' && f.options.length > 8),
    )
  );
}

export interface StepProps {
  step: IntakeStep;
  values: ScreenValues;
  /** The fields the answers show (`shownIntakeKeys` over the whole form). */
  shown: ReadonlySet<string>;
  onChange: (key: string, value: ScreenValue) => void;
  errors: Readonly<Record<string, string>>;
  fill: Fill;
  actions: UploadActions;
  /** The form's mockup layout (intake-layout); without one, the plain two-column panels. */
  look?: FormLook;
}

type FieldProps = Omit<StepProps, 'step' | 'shown' | 'look'>;

/** One field of a step, by its type. */
export function FieldInput({
  field,
  values,
  onChange,
  errors,
  fill,
  actions,
  look,
  groupLook,
}: FieldProps & { field: IntakeField; look?: FieldLook; groupLook?: RowsLook | undefined }) {
  const value = values[field.key];
  const set = (v: ScreenValue) => onChange(field.key, v);
  switch (field.type) {
    case 'info':
      return <InfoNote label={fill(field.label)} text={fill(field.text)} list={look?.list} />;
    case 'grid':
      return (
        <GridInput
          field={field}
          value={(value ?? {}) as ScreenGrid}
          onChange={set}
          errors={errors}
          fill={fill}
          quiet={look?.quiet === true}
        />
      );
    case 'group':
      return (
        <GroupInput
          field={field}
          rows={(value ?? []) as ScreenRow[]}
          onChange={set}
          errors={errors}
          fill={fill}
          look={groupLook}
        />
      );
    case 'upload':
      return (
        <UploadInput
          field={field}
          value={(value ?? { notAvailable: false, reason: '' }) as ScreenUpload}
          onChange={set}
          errors={errors}
          fill={fill}
          actions={actions}
          tile={look?.tile === true}
          quiet={look?.quiet === true}
        />
      );
    default:
      return (
        <ScalarInput
          field={field}
          name={field.key}
          value={(value ?? null) as ScreenScalar}
          onChange={set}
          error={errors[issueKey([field.key])]}
          fill={fill}
          {...(look ? { look } : {})}
        />
      );
  }
}

/** A section's shown fields: in its mockup's rows when the form has a look for it. */
function SectionFields({
  section,
  panel,
  props,
  visible,
  skip,
}: {
  section: IntakeSection;
  panel: PanelLook | undefined;
  props: FieldProps;
  visible: (key: string) => boolean;
  skip: string | undefined;
}) {
  const fields = section.fields.filter((f) => visible(f.key) && f.key !== skip);
  if (!panel) {
    return (
      <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2" data-section={section.key}>
        {fields.map((f) => (
          <div key={f.key} className={wideField(f) ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
            <FieldInput field={f} {...props} />
          </div>
        ))}
      </div>
    );
  }
  // A bar's one field is named by the bar's subtitle; a field named like its panel keeps its
  // label for screen readers only (the title already says it).
  const title = props.fill(section.title);
  const quiet = (f: IntakeField) =>
    (panel.bar && fields.length === 1) || props.fill(f.label) === title;
  if (panel.tiles) {
    return (
      <div
        data-section={section.key}
        className={`grid gap-2 sm:grid-cols-2 ${TILE_COLUMNS[Math.min(fields.length, 5)] ?? ''}`}
      >
        {fields.map((f) => (
          <FieldInput key={f.key} field={f} {...props} look={{ tile: true }} />
        ))}
      </div>
    );
  }
  return (
    <div data-section={section.key} className="min-w-0 flex-1">
      <FieldRows
        fields={fields}
        look={panel}
        render={(f, fieldLook) => (
          <FieldInput
            field={f}
            {...props}
            look={{
              ...fieldLook,
              ...(quiet(f) ? { quiet: true } : {}),
              ...(panel.intro && f.type === 'info' ? { list: true } : {}),
            }}
            groupLook={f.type === 'group' ? panel.groups?.[f.key] : undefined}
          />
        )}
      />
    </div>
  );
}

/** Upload tiles' columns by how many there are (whole classes, so Tailwind finds them). */
const TILE_COLUMNS: Record<number, string> = {
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
};

/** A joined section inside a panel: its own heading with an icon, then its fields. */
function JoinedPart({
  heading,
  icon: Icon,
  children,
}: {
  heading: string;
  icon: LucideIcon | undefined;
  children: ReactNode;
}) {
  const [main, bracket] = splitBracket(heading);
  return (
    <div className="mt-3 first:mt-0">
      <h3 className="mb-1 flex items-center gap-2">
        {Icon && (
          <Icon aria-hidden="true" className="size-5 shrink-0 fill-accent-soft text-accent" />
        )}
        <span className="font-display text-base font-bold text-heading">{main}</span>
        {bracket && <span className="text-xs text-firm-primary">{bracket}</span>}
      </h3>
      {children}
    </div>
  );
}

/**
 * A step's numbered panels with the fields the answers show, set out as the form's mockup has
 * them (intake-layout): two to a row unless wide, joined sections in one panel, icons, bars.
 */
export function StepSections({ step, shown, look = NO_LOOK, ...props }: StepProps) {
  const visible = (key: string) => shown.has(key);
  const sections = step.sections.filter((s) => s.fields.some((f) => visible(f.key)));
  // A joined panel takes the place of its first shown member; the others are drawn inside it.
  const anchorOf = new Map<string, string>();
  for (const [key, panel] of Object.entries(look.panels)) {
    for (const member of panel.join ?? []) anchorOf.set(member, key);
  }
  const panels: { key: string; panel: PanelLook | undefined; parts: IntakeSection[] }[] = [];
  for (const section of sections) {
    const anchor = anchorOf.get(section.key);
    if (anchor === undefined) {
      panels.push({ key: section.key, panel: look.panels[section.key], parts: [section] });
      continue;
    }
    if (panels.some((p) => p.key === anchor)) continue;
    const members = look.panels[anchor]!.join!;
    const parts = members.flatMap((k) => sections.find((s) => s.key === k) ?? []);
    panels.push({ key: anchor, panel: look.panels[anchor], parts });
  }
  const isWide = (p: (typeof panels)[number]) =>
    p.panel ? !!(p.panel.wide || p.panel.bar) : wideSection(p.parts[0]!);
  const span = fullRows(panels.map(isWide));
  let number = 0;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {panels.map((p, i) => {
        const first = p.parts[0]!;
        const joined = p.panel?.join !== undefined;
        const subtitle =
          p.panel?.subtitle ??
          (p.panel?.intro ? step.subtitle : undefined) ??
          (joined ? undefined : (first.subtitle ?? soleHelp(first, visible, props.fill)));
        const barSubtitle = p.panel?.bar ? barLabel(first, visible, props.fill) : undefined;
        const unnumbered = p.panel?.bar || p.panel?.intro || p.panel?.headless;
        const Badge = p.panel?.badge;
        return (
          <SectionPanel
            key={p.key}
            number={unnumbered ? undefined : (number += 1)}
            badge={Badge ? <Badge className="size-6" /> : undefined}
            size={p.panel?.headless ? 'none' : p.panel?.intro ? 'intro' : 'panel'}
            title={props.fill(p.panel?.title ?? first.title)}
            subtitle={subtitle ? props.fill(subtitle) : barSubtitle}
            icon={p.panel?.icon ? <PanelIcon icon={p.panel.icon} /> : undefined}
            iconPosition={p.panel?.iconFirst || p.panel?.bar ? 'start' : 'end'}
            bar={p.panel?.bar}
            tint={p.panel?.tint}
            className={span[i] ? 'lg:col-span-2' : ''}
          >
            {joined
              ? p.parts.map((part) => (
                  <JoinedPart
                    key={part.key}
                    heading={props.fill(part.title)}
                    icon={p.panel?.joinIcons?.[part.key]}
                  >
                    <SectionFields
                      section={part}
                      panel={look.panels[part.key] ?? p.panel}
                      props={props}
                      visible={visible}
                      skip={look.footerNote}
                    />
                  </JoinedPart>
                ))
              : p.parts.map((part) => (
                  <SectionFields
                    key={part.key}
                    section={part}
                    panel={p.panel}
                    props={props}
                    visible={visible}
                    skip={look.footerNote}
                  />
                ))}
          </SectionPanel>
        );
      })}
    </div>
  );
}

function PanelIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon className="size-10 fill-accent-soft" strokeWidth={1.75} />;
}

/** A panel's one field named like the panel: its help line serves as the panel's subtitle. */
function soleHelp(section: IntakeSection, visible: (key: string) => boolean, fill: Fill) {
  const fields = section.fields.filter((f) => visible(f.key));
  const only = fields.length === 1 ? fields[0]! : undefined;
  return only && 'help' in only && only.help && fill(only.label) === fill(section.title)
    ? only.help
    : undefined;
}

/** A bar's one field: its label is the bar's subtitle. */
function barLabel(section: IntakeSection, visible: (key: string) => boolean, fill: Fill) {
  const fields = section.fields.filter((f) => visible(f.key) && f.type !== 'info');
  return fields.length === 1 ? fill(fields[0]!.label) : undefined;
}
