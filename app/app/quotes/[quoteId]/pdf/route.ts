import { requireSession } from '@/lib/auth/current-user';
import { quotePdfFilename, renderQuotePdfForBusiness } from '@/lib/pdf/quote-service';

/**
 * The contractor's PDF.
 *
 * Rendered on demand from the database rows, never from a cached file: what is
 * downloaded is always the current state of the quote, and a quote that has
 * been accepted carries its acceptance record on the document.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  const session = await requireSession();
  const { quoteId } = await params;

  const rendered = await renderQuotePdfForBusiness(
    session.businessId,
    session.userId,
    quoteId,
    session.fullName
  );

  if (!rendered) {
    return new Response('Quote not found', { status: 404 });
  }

  return new Response(Buffer.from(rendered.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${quotePdfFilename(rendered.model)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
