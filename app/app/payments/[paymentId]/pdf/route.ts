import { requireSession } from '@/lib/auth/current-user';
import { receiptPdfFilename, renderReceiptPdfForBusiness } from '@/lib/pdf/receipt-service';

/**
 * The contractor's receipt PDF.
 *
 * Rendered on demand from the database rows: the balances printed are the ones
 * the receipt row remembered when the payment landed, so a receipt downloaded
 * today is byte-for-byte the same document the customer was promised.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  const session = await requireSession();
  const { paymentId } = await params;

  const rendered = await renderReceiptPdfForBusiness(
    session.businessId,
    session.userId,
    paymentId
  );

  if (!rendered) {
    return new Response('Receipt not found', { status: 404 });
  }

  return new Response(Buffer.from(rendered.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${receiptPdfFilename(rendered.model)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
