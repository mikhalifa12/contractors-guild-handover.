import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { RegisterForm } from '@/components/forms/auth-forms';
import { Alert } from '@/components/ui/feedback';
import { getCurrentSession } from '@/lib/auth/current-user';

export const metadata: Metadata = { title: 'Create your account' };
export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  try {
    const session = await getCurrentSession();
    if (session) redirect('/app');
  } catch {
    // Ignore: the form can still be shown if the database is temporarily down.
  }

  return (
    <>
      <h1 className="cg-display text-2xl text-paper">Create your account</h1>
      <p className="mt-2 text-sm text-steel-400">
        Set up your business workspace. You can change every detail later in Settings.
      </p>

      <div className="mt-6 space-y-4">
        <Alert tone="info">
          <p>
            Your data is isolated per business: customers, quotes, invoices and banking details are
            only ever visible to your own account.
          </p>
        </Alert>

        <RegisterForm />
      </div>
    </>
  );
}
