import { AppShell } from '@/components/app/app-shell';
import { requireSession } from '@/lib/auth/current-user';

/**
 * The secure contractor area.
 *
 * `requireSession()` redirects to /login when there is no valid session, and
 * every page below it runs with the tenant context taken from that session.
 */
export const dynamic = 'force-dynamic';

export default async function ApplicationLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return <AppShell session={session}>{children}</AppShell>;
}
