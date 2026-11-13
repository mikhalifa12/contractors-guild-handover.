-- Phase 5: payments and receipts.
--
-- The payments and receipts tables themselves ship in 0001. This migration
-- adds the two columns the payment flow needs:
--
--  payments.receipt_number
--    One payment, one receipt: the receipt row is created inside the same
--    transaction as the payment and carries the balances as they stood, but
--    the payment row is what the payments screen lists, so keeping the number
--    there makes "REC-0003" visible without a join. It is a mirrored column,
--    not a second source of truth: the receipt row remains the authoritative
--    record (receipt_number is unique per business there), and every write
--    path sets both from one allocation.
--
--  receipts.status_before
--    The invoice status the instant before its payment was recorded. When a
--    payment is reversed, the invoice walks back down the path it actually
--    took (PAID -> PARTIALLY_PAID -> SENT) instead of collapsing to one state.
--
-- Status transitions stay application-owned (lib/invoices.ts): a payment
-- moves the invoice to PARTIALLY_PAID or PAID by recomputing the balance from
-- the stored money. No database trigger writes statuses, so the money rules
-- stay in one testable place.

alter table public.payments
  add column if not exists receipt_number text;

alter table public.receipts
  add column if not exists status_before public.invoice_status;

-- At most one receipt per payment (one-to-one by design).
create unique index if not exists payments_receipt_number_idx
  on public.payments (receipt_number) where receipt_number is not null;

comment on table public.payments is
  'Money received against an invoice. Recording and reversing a payment drives the invoice status (PARTIALLY_PAID / PAID) through lib/invoices.ts; the database stores the resulting status only.';
