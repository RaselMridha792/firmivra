'use client';

import { useId, type InputHTMLAttributes } from 'react';

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
}
/** Use the same name for a group; native radios provide arrow-key navigation. */
export function Radio({ label, id, className = '', ...props }: RadioProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <label htmlFor={fieldId} className={`flex min-h-11 items-center gap-3 text-sm ${className}`}>
      <input {...props} id={fieldId} type="radio" className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </label>
  );
}
