'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Read-only share link with a copy button.
 *
 * The plain input is the fallback: if the clipboard API is unavailable (older
 * browsers, non-secure contexts) the contractor can still select and copy, and
 * the link is visible so it can be read out over the phone.
 */
export function CopyField({
  value,
  label,
  hint,
  className,
}: {
  value: string;
  label: string;
  hint?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="cg-label" htmlFor="share-link">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id="share-link"
          className="cg-input font-mono text-xs"
          value={value}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          onClick={copy}
          className="min-h-12 whitespace-nowrap rounded-lg border border-ink-600 bg-ink-800 px-3 text-xs font-semibold uppercase tracking-wide text-steel-200 hover:border-ember-500 hover:text-paper"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {hint ? <p className="cg-hint">{hint}</p> : null}
    </div>
  );
}
