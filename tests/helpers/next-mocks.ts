/**
 * Minimal stand-ins for the Next.js request APIs so Server Actions can be
 * exercised in tests exactly as they run in the app (same code path, real
 * database, real RLS) without booting a web server.
 */
class CookieJar {
  private values = new Map<string, string>();

  // Next.js `cookies()` returns an object with SYNCHRONOUS get/set/delete.
  get(name: string) {
    const value = this.values.get(name);
    return value === undefined ? undefined : { name, value };
  }

  set(name: string, value: string) {
    if (value === '') {
      this.values.delete(name);
      return;
    }
    this.values.set(name, value);
  }

  delete(name: string) {
    this.values.delete(name);
  }

  /** Test helper: read a cookie value directly. */
  peek(name: string): string | undefined {
    return this.values.get(name);
  }

  /** Test helper: clear all cookies (used between cases). */
  clear(): void {
    this.values.clear();
  }
}

export class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`NEXT_REDIRECT:${url}`);
    this.name = 'RedirectSignal';
  }
}

export const cookieStore = new CookieJar();
export const headersList = new Headers({
  'x-forwarded-for': '10.0.0.1, 10.0.0.2',
  'user-agent': 'vitest-agent',
});
