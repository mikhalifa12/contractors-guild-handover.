import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/forms/auth-forms';
import { Alert } from '@/components/ui/feedback';
import { getCurrentSession } from '@/lib/auth/current-user';
import { safeAppRedirectPath } from '@/lib/security/redirect';

export const metadata: Metadata = { title: 'Contractor login' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; next?: string }>;
}) {
  const params = await searchParams;
  // Only same-origin /app paths are honoured, so a crafted link cannot turn
  // sign-in into an open redirect.
  const nextPath = safeAppRedirectPath(params.next);

  // Signed-in users go straight to where they were heading.
  try {
    const session = await getCurrentSession();
    if (session) redirect(nextPath);
  } catch {
    // A database problem should surface on the dashboard, not block the form.
  }

  return (
    <>
      <h1 className="cg-display text-2xl text-paper">Contractor login</h1>
      <p className="mt-2 text-sm text-steel-400">
        Sign in to manage customers, quotes, invoices and payments.
      </p>

      <div className="mt-6 space-y-4">
        {params.reset === '1' ? (
          <Alert tone="info">
            <p>Your password has been updated. Sign in with your new password.</p>
          </Alert>
        ) : null}

        <LoginForm next={nextPath === '/app' ? undefined : nextPath} />
      </div>
    </>
  );
}
