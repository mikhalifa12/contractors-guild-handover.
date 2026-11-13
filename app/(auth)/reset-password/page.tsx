import type { Metadata } from 'next';
import Link from 'next/link';
import { ResetPasswordForm } from '@/components/forms/auth-forms';

export const metadata: Metadata = { title: 'Choose a new password' };
export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token?.trim() ?? '';

  if (!token) {
    return (
      <>
        <h1 className="cg-display text-2xl text-paper">Reset link missing</h1>
        <p className="mt-2 text-sm text-steel-400">
          This page needs a valid reset link. Request a new one and open the link from that
          message.
        </p>
        <p className="mt-6 text-sm">
          <Link href="/forgot-password" className="font-semibold text-ember-400 hover:text-ember-300">
            Request a new reset link
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="cg-display text-2xl text-paper">Choose a new password</h1>
      <p className="mt-2 text-sm text-steel-400">
        Your other devices will be signed out once the password is changed.
      </p>

      <div className="mt-6">
        <ResetPasswordForm token={token} />
      </div>
    </>
  );
}
