import { requireSession } from '@/lib/auth/current-user';
import { invoicePdfFilename, renderInvoicePdfForBusiness } from '@/lib/pdf/invoice-service';

/**
 * The contractor's invoice PDF.
 *
 * Rendered on demand from the database rows, never from a cached file: what is
 * downloaded is always the current state of the invoice, including its paid
 * stamp once payments have settled it.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const session = await requireSession();
  const { invoiceId } = await params;

  const rendered = await renderInvoicePdfForBusiness(
    session.businessId,
    session.userId,
    invoiceId,
    session.fullName
  );

  if (!rendered) {
    return new Response('Invoice not found', { status: 404 });
  }

  return new Response(Buffer.from(rendered.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${invoicePdfFilename(rendered.model)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
