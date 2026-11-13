import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold uppercase tracking-[0.06em] transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-ember-500 text-white hover:bg-ember-400 active:bg-ember-600 shadow-[0_8px_24px_-12px_rgba(242,106,10,0.9)]',
  secondary:
    'border border-ink-600 bg-ink-800 text-paper hover:border-ember-500 hover:text-white',
  ghost: 'text-steel-300 hover:bg-ink-800 hover:text-paper',
  danger: 'border border-signal-danger/50 bg-signal-danger/10 text-signal-danger hover:bg-signal-danger/20',
};

const SIZES: Record<Size, string> = {
  // 44-48px minimum height keeps touch targets usable one-handed on a phone.
  sm: 'min-h-10 px-3.5 text-xs',
  md: 'min-h-12 px-5 text-sm',
  lg: 'min-h-14 px-6 text-sm sm:text-base',
};

export function buttonClasses(variant: Variant = 'primary', size: Size = 'md', className?: string) {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

type ButtonProps = ComponentProps<'button'> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button className={buttonClasses(variant, size, className)} {...props}>
      {children}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: Variant;
  size?: Size;
};

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...props}>
      {children}
    </Link>
  );
}
