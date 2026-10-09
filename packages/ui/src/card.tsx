import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  /** `elevated`: the mockups' borderless card with a soft shadow (portal Appointments, Super Admin). */
  variant?: 'outlined' | 'elevated';
}

const variants = {
  outlined: 'rounded-card border border-border shadow-card',
  elevated: 'rounded-xl shadow-md',
};

export function Card({
  title,
  variant = 'outlined',
  className = '',
  children,
  ...props
}: CardProps) {
  return (
    <section className={`bg-surface p-6 ${variants[variant]} ${className}`} {...props}>
      {title ? <h2 className="mb-4 text-lg font-semibold text-text">{title}</h2> : null}
      {children}
    </section>
  );
}
