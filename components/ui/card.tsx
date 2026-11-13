import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatCurrency } from '@/lib/money';

export function Card({
  children,
  className,
  raised = false,
}: {
  children: ReactNode;
  className?: string;
  raised?: boolean;
}) {
  return (
    <section className={cn('cg-card', raised && 'cg-card-raised', className)}>{children}</section>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-ink-700 px-4 py-3.5 sm:px-5',
        className
      )}
    >
      <div>
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-paper">{title}</h2>
        {description ? <p className="mt-1 text-xs text-steel-500">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-4 py-4 sm:px-5', className)}>{children}</div>;
}

/**
 * Dashboard metric card. Values are passed in cents so no floating point
 * arithmetic happens during rendering.
 */
export function StatCard({
  label,
  valueCents,
  currencyCode = 'ZAR',
  hint,
  tone = 'default',
  href,
}: {
  label: string;
  valueCents: number;
  currencyCode?: string;
  hint?: string;
  tone?: 'default' | 'ember' | 'warning' | 'danger' | 'success';
  href?: string;
}) {
  const tones = {
    default: 'text-paper',
    ember: 'text-ember-400',
    warning: 'text-signal-warning',
    danger: 'text-signal-danger',
    success: 'text-signal-success',
  } as const;

  const content = (
    <>
      <p className="text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-steel-500">
        {label}
      </p>
      <p className={cn('mt-2 text-2xl font-bold tabular-nums', tones[tone])}>
        {formatCurrency(valueCents / 100, currencyCode)}
      </p>
      {hint ? <p className="mt-1.5 text-xs text-steel-500">{hint}</p> : null}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        className="cg-card cg-card-raised block px-4 py-4 transition-colors hover:border-ember-500/60"
      >
        {content}
      </a>
    );
  }

  return <div className="cg-card cg-card-raised px-4 py-4">{content}</div>;
}

export function CountCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'default' | 'ember' | 'warning' | 'danger';
}) {
  const tones = {
    default: 'text-paper',
    ember: 'text-ember-400',
    warning: 'text-signal-warning',
    danger: 'text-signal-danger',
  } as const;

  return (
    <div className="cg-card cg-card-raised px-4 py-4">
      <p className="text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-steel-500">
        {label}
      </p>
      <p className={cn('mt-2 text-2xl font-bold tabular-nums', tones[tone])}>{value}</p>
      {hint ? <p className="mt-1.5 text-xs text-steel-500">{hint}</p> : null}
    </div>
  );
}
