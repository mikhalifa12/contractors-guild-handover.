import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { ChangePasswordForm, ProfileForm } from '@/components/forms/account-forms';
import { SETTINGS_LINKS } from '@/components/app/nav-items';
import { requireSession } from '@/lib/auth/current-user';
import { getProfile } from '@/lib/repositories/users';
import { formatDateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Your account' };

export default async function AccountSettingsPage() {
  const session = await requireSession();
  const profile = await getProfile(session.userId);

  return (
    <>
      <header>
        <p className="cg-eyebrow">Settings</p>
        <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">Your account</h1>
        <p className="mt-1.5 text-sm text-steel-500">
          Your login details and personal information.
        </p>
      </header>

      <nav aria-label="Settings sections" className="flex flex-wrap gap-2">
        {SETTINGS_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-md border border-ink-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-steel-300 hover:border-ember-500 hover:text-paper"
          >
            {link.label}
          </Link>
        ))}
      </nav>

      {!profile ? (
        <Alert tone="danger" title="Account not found">
          <p>We could not load your account. Refresh the page or contact support.</p>
        </Alert>
      ) : (
        <>
          <Card>
            <CardHeader
              title="Profile"
              description={`Account created ${formatDateTime(profile.created_at)}`}
            />
            <CardBody>
              <ProfileForm
                fullName={profile.full_name}
                phone={profile.phone}
                email={profile.email}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Password"
              description="Changing your password signs out your other devices"
            />
            <CardBody>
              <ChangePasswordForm />
            </CardBody>
          </Card>
        </>
      )}

      <Alert tone="info" title="Sessions">
        <p>
          Sessions are stored as hashed tokens and expire automatically. Signing out revokes the
          session immediately.
        </p>
      </Alert>
    </>
  );
}
