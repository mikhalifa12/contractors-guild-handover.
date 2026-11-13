import Link from 'next/link';

export const metadata = { title: 'You are offline' };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-ink-950 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-ember-500/15 text-3xl">
        <span aria-hidden>📡</span>
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-black uppercase tracking-wide text-paper">No connection</h1>
        <p className="max-w-sm text-sm text-steel-400">
          This app runs from your workshop computer, and it is switched off or out of reach right
          now. Reconnect to the same Wi‑Fi (or data) and try again — your figures were never at
          risk: nothing is saved on the phone.
        </p>
      </div>
      <Link
        href="/app"
        className="inline-flex items-center justify-center rounded-lg bg-ember-500 px-5 py-2.5 text-sm font-bold uppercase tracking-[0.08em] text-white transition-colors hover:bg-ember-400"
      >
        Try again
      </Link>
      <p className="text-xs text-steel-500">
        Tip: keep the workshop PC running and on the same Wi‑Fi as your phone.
      </p>
    </main>
  );
}
