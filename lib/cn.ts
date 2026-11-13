/**
 * Tiny className combiner (no dependency needed): joins truthy class names.
 */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}
