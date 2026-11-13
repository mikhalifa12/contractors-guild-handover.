import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/forms/auth-forms';
import { Alert } from '@/components/ui/feedback';

export const metadata: Metadata = { title: 'Reset your password' };
export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="cg-display text-2xl text-paper">Reset your password</h1>
      <p className="mt-2 text-sm text-steel-400">
        Enter the email address you registered with and we will send a reset link.
      </p>

      <div className="mt-6 space-y-4">
        <Alert tone="warning" title="Email delivery is not configured yet">
          <p>
            Phase 1 has no email provider connected. In development the reset link is returned
            below instead of being emailed; in production this message is all you would see until
            an email provider is added (see ROADMAP.md).
          </p>
        </Alert>

        <ForgotPasswordForm />
      </div>
    </>
  );
}
