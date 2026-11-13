import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ServiceWorkerRegistration } from '../components/pwa/service-worker-registration';

export const metadata: Metadata = {
  title: {
    default: 'Contractors Guild — Powered by contractors. Built on trust.',
    template: '%s · Contractors Guild',
  },
  description:
    'Contractors Guild: electrical fault finding, installations, repairs and maintenance, plus the contractor platform for quotes, invoices and payments.',
  applicationName: 'Contractors Guild',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'CG',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    telephone: false,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#07080a',
  // Contractors zoom into tables and photos; never block pinch-zoom.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA">
      <body className="min-h-dvh bg-ink-950 text-paper antialiased">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
