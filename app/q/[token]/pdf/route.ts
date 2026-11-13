import { renderPublicQuotePdf } from '@/lib/pdf/quote-service';

/**
 * The customer's PDF, reached through the public token.
 *
 * No session is required — holding the token is what grants access to this one
 * document, and it is the same document the contractor can download.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const rendered = await renderPublicQuotePdf(token);

  if (!rendered) {
    return new Response('Quote not found', { status: 404 });
  }

  return new Response(Buffer.from(rendered.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${rendered.model.quote.number}.pdf"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
