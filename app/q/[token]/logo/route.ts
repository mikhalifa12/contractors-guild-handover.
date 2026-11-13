import { getPublicQuoteLogoKey } from '@/lib/repositories/public-quotes';
import { getStorage } from '@/lib/storage';

/**
 * The business logo for the customer's copy of a quote.
 *
 * Served through the quote token rather than the internal business id, so a
 * customer never learns an identifier they have no business knowing, and the
 * image is only reachable by someone holding the link.
 */
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const key = await getPublicQuoteLogoKey(token);
  if (!key) return new Response('Not found', { status: 404 });

  const file = await getStorage().read(key);
  if (!file) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(file.data), {
    headers: {
      'Content-Type': file.contentType,
      'Cache-Control': 'private, max-age=300',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
