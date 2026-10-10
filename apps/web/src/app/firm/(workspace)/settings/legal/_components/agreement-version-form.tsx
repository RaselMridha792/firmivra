'use client';

import {
  AcknowledgmentKey,
  AGREEMENT_ERRORS,
  type AgreementVersion,
  PublishAgreementVersionRequest,
} from '@firmivra/types';
import { Button, Card, Checkbox, Input } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { type FieldErrors, type Resolver, useFieldArray, useForm } from 'react-hook-form';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { TextArea } from '../../../../setup/_components/fields';
import { AGREEMENTS } from './agreements-shared';

const MAX_BOXES = 8;

type Box = { key: string; label: string; text: string; required: boolean };
type Values = {
  title: string;
  effectiveDate: string;
  bodyMarkdown: string;
  acknowledgments: Box[];
};

/**
 * A box keeps its key across versions; a new one gets a key from its label ("I have read it"
 * becomes box_i_have_read_it), made unique within the version.
 */
function withKeys(boxes: Box[]) {
  const valid = (key: string) => AcknowledgmentKey.safeParse(key).success;
  const used = new Set(boxes.filter((b) => valid(b.key)).map((b) => b.key));
  return boxes.map((box, index) => {
    if (valid(box.key)) return box;
    const base = `box_${box.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
      .replace(/_+$/, '')
      .slice(0, 36);
    let key = base.length > 4 ? base : `box_${index + 1}`;
    for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
    used.add(key);
    return { ...box, key };
  });
}

const toBody = (values: Values, expected: number | null): PublishAgreementVersionRequest => ({
  expectedCurrentVersion: expected,
  title: values.title,
  bodyMarkdown: values.bodyMarkdown,
  effectiveDate: values.effectiveDate || null,
  acknowledgments: withKeys(values.acknowledgments),
});

/** The contract's own checks on the request the form makes, plus the firm-wide box rule. */
const contract = zodResolver(PublishAgreementVersionRequest);
const resolverFor =
  (expected: number | null, firmWide: boolean): Resolver<Values> =>
  async (values, context, options) => {
    const result = await contract(toBody(values, expected), context, options as never);
    const errors: FieldErrors<Values> = { ...(result.errors as FieldErrors<Values>) };
    if (firmWide && !values.acknowledgments.some((box) => box.required)) {
      errors.acknowledgments = {
        type: 'validate',
        message: 'The firm-wide agreement needs a required box.',
      };
    }
    return Object.keys(errors).length > 0 ? { values: {}, errors } : { values, errors: {} };
  };

/** Publishes the next version, starting from the current one. Versions never change. */
export function AgreementVersionForm({
  agreementId,
  firmWide,
  current,
}: {
  agreementId: string;
  firmWide: boolean;
  current: AgreementVersion | null;
}) {
  const expected = current?.version ?? null;
  const form = useForm<Values>({
    resolver: resolverFor(expected, firmWide),
    defaultValues: {
      title: current?.title ?? '',
      effectiveDate: '',
      bodyMarkdown: current?.bodyMarkdown ?? '',
      acknowledgments: current?.acknowledgments ?? [],
    },
  });
  const boxes = useFieldArray({ control: form.control, name: 'acknowledgments' });
  const publish = useApiMutation(
    (body: PublishAgreementVersionRequest) => api.agreements.publish(agreementId, body),
    { invalidate: AGREEMENTS },
  );
  const issues = form.formState.errors;
  const next = (current?.version ?? 0) + 1;

  return (
    <Card title={`Write version ${next}`}>
      <form
        onSubmit={form.handleSubmit((values) => publish.mutate(toBody(values, expected)))}
        noValidate
        className="flex flex-col gap-4"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Input
              label="Title"
              maxLength={200}
              error={issues.title?.message}
              {...form.register('title')}
            />
          </div>
          <Input
            label="Effective date (optional)"
            type="date"
            error={issues.effectiveDate?.message}
            {...form.register('effectiveDate')}
          />
        </div>
        <TextArea
          label="Agreement text"
          rows={12}
          error={issues.bodyMarkdown?.message}
          {...form.register('bodyMarkdown')}
        />
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium text-text">Boxes the signer ticks</legend>
          {boxes.fields.map((field, index) => (
            <div
              key={field.id}
              data-testid="agreement-box"
              className="flex flex-col gap-3 rounded-control border border-border p-4"
            >
              <Input
                label="Box label"
                maxLength={120}
                error={issues.acknowledgments?.[index]?.label?.message}
                {...form.register(`acknowledgments.${index}.label`)}
              />
              <TextArea
                label="Box text"
                rows={2}
                error={issues.acknowledgments?.[index]?.text?.message}
                {...form.register(`acknowledgments.${index}.text`)}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Checkbox
                  label="Required to submit"
                  {...form.register(`acknowledgments.${index}.required`)}
                />
                <Button variant="ghost" onClick={() => boxes.remove(index)}>
                  Remove box
                </Button>
              </div>
            </div>
          ))}
          {issues.acknowledgments?.message || issues.acknowledgments?.root?.message ? (
            <p className="text-xs text-danger">
              {issues.acknowledgments.message ?? issues.acknowledgments.root?.message}
            </p>
          ) : null}
          <Button
            variant="secondary"
            disabled={boxes.fields.length >= MAX_BOXES}
            onClick={() => boxes.append({ key: '', label: '', text: '', required: true })}
          >
            Add a box
          </Button>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={publish.isPending}>
            {publish.isPending ? 'Publishing…' : `Publish version ${next}`}
          </Button>
          {publish.error ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(publish.error, AGREEMENT_ERRORS)}
            </p>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
