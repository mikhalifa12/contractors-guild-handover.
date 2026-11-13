import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth/current-user';
import { isUuid } from '@/lib/db';
import { getBusinessLogoKey } from '@/lib/repositories/businesses';
import { getStorage } from '@/lib/storage';

/**
 * Serve a business logo.
 *
 * Access rules:
 *  - Requires a valid session (the logo is not public).
 *  - The requested business must be the business in the caller's own session,
 *    and the lookup goes through a tenant-scoped query, so guessing another
 *    business id returns 404 rather than leaking the image.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ businessId: string }> }
): Promise<Response> {
  const { businessId } = await context.params;

  if (!isUuid(businessId)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const session = await getCurrentSession();
  if (!session || session.businessId !== businessId) {
    return new NextResponse('Not found', { status: 404 });
  }

  const storageKey = await getBusinessLogoKey(businessId, session.userId);
  if (!storageKey) {
    return new NextResponse('Not found', { status: 404 });
  }

  const file = await getStorage().read(storageKey);
  if (!file) {
    return new NextResponse('Not found', { status: 404 });
  }

  return new NextResponse(new Uint8Array(file.data), {
    status: 200,
    headers: {
      'Content-Type': file.contentType,
      'Content-Length': String(file.data.byteLength),
      // Private: browsers and shared proxies must not cache this for others.
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  });
}
