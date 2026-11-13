import type { MetadataRoute } from 'next';

/**
 * PWA manifest — this is what makes the app "installable" on Android.
 * Chrome offers "Add to Home screen"; the app then opens fullscreen with its
 * own icon, splash colour and window, like a Play Store app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Contractors Guild',
    short_name: 'CG',
    description:
      'Contractor business management: quotes, invoices, payments and customers — offline-capable on site.',
    id: '/',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#07080a',
    theme_color: '#07080a',
    lang: 'en-ZA',
    categories: ['business', 'productivity', 'finance'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
