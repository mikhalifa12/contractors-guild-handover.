import Link from 'next/link';
import { Logo } from '@/components/brand/logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="cg-texture flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Link href="/" aria-label="Contractors Guild home">
            <Logo size="lg" showTagline />
          </Link>
        </div>

        <main className="cg-card cg-card-raised p-6 sm:p-7">{children}</main>

        <p className="mt-6 text-center text-xs text-steel-500">
          <Link href="/" className="hover:text-paper">
            ← Back to the website
          </Link>
        </p>
      </div>
    </div>
  );
}
