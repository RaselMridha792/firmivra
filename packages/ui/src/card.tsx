import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
}

export function Card({ title, className = '', children, ...props }: CardProps) {
  return (
    <section
      className={`rounded-card border border-border bg-surface p-6 shadow-card ${className}`}
      {...props}
    >
      {title ? <h2 className="mb-4 text-lg font-semibold text-text">{title}</h2> : null}
      {children}
    </section>
  );
}
