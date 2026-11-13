import { ButtonLink } from '@/components/ui/button';
import { Logo } from '@/components/brand/logo';

export default function NotFound() {
  return (
    <main className="cg-texture flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <Logo size="lg" showTagline />
      <p className="cg-eyebrow">404 — page not found</p>
      <h1 className="cg-display max-w-xl text-3xl text-paper sm:text-4xl">
        That page is not wired up yet
      </h1>
      <p className="max-w-md text-sm text-steel-400">
        The link may be out of date, or the page belongs to a later phase of the build.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <ButtonLink href="/">Back to the website</ButtonLink>
        <ButtonLink href="/app" variant="secondary">
          Go to the dashboard
        </ButtonLink>
      </div>
    </main>
  );
}
