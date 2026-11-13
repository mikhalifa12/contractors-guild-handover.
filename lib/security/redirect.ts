/**
 * Safe redirect targets.
 *
 * `next` parameters are user input, so they must never be able to send a
 * signed-in visitor to another origin (an open redirect can be used for
 * phishing: "log in at Contractors Guild" that lands on an attacker's clone).
 *
 * Only same-origin application paths are accepted. Everything else falls back
 * to the dashboard.
 */
export function safeAppRedirectPath(candidate: unknown, fallback = '/app'): string {
  if (typeof candidate !== 'string') return fallback;

  const value = candidate.trim();
  if (value.length === 0 || value.length > 300) return fallback;
  if (!value.startsWith('/')) return fallback;
  // "//host" and "/\host" are protocol-relative URLs, not local paths.
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (value.includes('\\')) return fallback;
  // Control characters can be used to smuggle headers into a redirect.
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (!value.startsWith('/app')) return fallback;

  return value;
}
