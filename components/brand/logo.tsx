import { cn } from '@/lib/cn';

/**
 * Contractors Guild brand mark: a hard-edged shield carrying a lightning bolt,
 * drawn as inline SVG so it stays crisp at every size and ships with the page
 * (no external asset request, no image to break).
 *
 * The mark is a faithful recreation of the shield/lightning identity described
 * in the brand sheet. Replacing it later means editing this one component.
 */
export function LogoMark({
  className,
  title = 'Contractors Guild',
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 72"
      role="img"
      aria-label={title}
      className={cn('h-9 w-auto', className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="cg-shield-face" x1="32" y1="0" x2="32" y2="72">
          <stop offset="0%" stopColor="#1f232a" />
          <stop offset="100%" stopColor="#0d0f12" />
        </linearGradient>
        <linearGradient id="cg-bolt" x1="18" y1="18" x2="46" y2="56">
          <stop offset="0%" stopColor="#ffc24b" />
          <stop offset="45%" stopColor="#ff8f42" />
          <stop offset="100%" stopColor="#f26a0a" />
        </linearGradient>
      </defs>

      {/* Shield body */}
      <path
        d="M32 2 60 12v22c0 17-11.6 27.4-28 36C15.6 61.4 4 51 4 34V12L32 2Z"
        fill="url(#cg-shield-face)"
        stroke="#f26a0a"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {/* Inner keyline gives the industrial, plated look */}
      <path
        d="M32 9.5 53 17v17c0 13.4-8.8 21.8-21 28.6C19.8 55.8 11 47.4 11 34V17L32 9.5Z"
        stroke="#f26a0a"
        strokeOpacity="0.35"
        strokeWidth="1.5"
        fill="none"
        strokeLinejoin="round"
      />
      {/* Lightning bolt */}
      <path d="M36.5 18 21 40h9.2L26 54l16.5-23.5h-9.7L36.5 18Z" fill="url(#cg-bolt)" />
    </svg>
  );
}

export function Logo({
  className,
  size = 'md',
  showTagline = false,
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
}) {
  const sizes = {
    sm: { mark: 'h-7', word: 'text-sm', tag: 'text-[0.5625rem]' },
    md: { mark: 'h-9', word: 'text-base', tag: 'text-[0.625rem]' },
    lg: { mark: 'h-12', word: 'text-xl', tag: 'text-xs' },
  } as const;

  const current = sizes[size];

  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={current.mark} />
      <span className="flex flex-col leading-none">
        <span className={cn('cg-display text-paper', current.word)}>
          Contractors<span className="text-ember-500">&nbsp;Guild</span>
        </span>
        {showTagline ? (
          <span className={cn('mt-1 font-semibold uppercase tracking-[0.2em] text-steel-500', current.tag)}>
            Powered by contractors
          </span>
        ) : null}
      </span>
    </span>
  );
}
