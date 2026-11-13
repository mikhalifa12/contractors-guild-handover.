import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { getCurrentSession } from '@/lib/auth/current-user';

/**
 * Public marketing layout.
 *
 * The header reflects whether a contractor is already signed in. A database
 * problem must never take the public website down, so the check fails safe to
 * "signed out".
 */
export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let isSignedIn = false;
  try {
    isSignedIn = (await getCurrentSession()) !== null;
  } catch {
    isSignedIn = false;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader isSignedIn={isSignedIn} />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
