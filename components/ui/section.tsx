import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Section({
  children,
  className,
  id,
  tone = 'dark',
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  tone?: 'dark' | 'darker' | 'panel';
}) {
  const tones = {
    dark: 'bg-ink-950',
    darker: 'bg-ink-900',
    panel: 'bg-ink-850',
  } as const;

  return (
    <section id={id} className={cn('cg-texture px-4 py-14 sm:px-6 sm:py-20', tones[tone], className)}>
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'left',
  accent = true,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: 'left' | 'center';
  accent?: boolean;
}) {
  return (
    <div className={cn('max-w-3xl', align === 'center' && 'mx-auto text-center')}>
      {eyebrow ? <p className="cg-eyebrow">{eyebrow}</p> : null}
      <h2
        className={cn(
          'cg-display mt-2 text-3xl text-paper sm:text-4xl',
          accent && align === 'left' && 'cg-underline-bar',
          accent && align === 'center' && 'after:mx-auto'
        )}
      >
        {title}
      </h2>
      {description ? (
        <p className="mt-4 text-base leading-relaxed text-steel-400">{description}</p>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="cg-card flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon ? <div className="text-ember-500">{icon}</div> : null}
      <h3 className="text-base font-bold uppercase tracking-wider text-paper">{title}</h3>
      {description ? <p className="max-w-md text-sm text-steel-400">{description}</p> : null}
      {action}
    </div>
  );
}
