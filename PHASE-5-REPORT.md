# Phase 5 report — payments, receipts and the receipt PDF

Phase 5 of the Contractors Guild build: **recording payments against invoices**, the **automatic
`PARTIALLY_PAID` / `PAID` transitions**, **payment reversal with status walk-back**, and the
**branded receipt PDF**. No table, column or constraint from Phases 1–4 was changed or removed;
migration 0009 only *adds* columns.

---

## What was delivered

### The payment transaction

[recordPayment()](lib/repositories/payments.ts) does everything in **one transaction**, in this
order:

1. **Lock the invoice row** (`for update`) — two devices can never both record a payment against
   the same balance at the same moment.
2. **Payability check** — only a *sent* invoice carries money owed: `SENT`, `VIEWED`,
   `PARTIALLY_PAID` and `OVERDUE` accept payments; a **draft has not been issued** and a
   **cancelled invoice is a closed record**, so both are refused (`not_payable`).
3. **Balance check** — the balance is recomputed from the stored `total` and `amount_paid` (integer
   cents, `lib/money.ts`); **overpayment is refused, never silently clamped** (`overpayment`). The
   database check `amount_paid <= total` remains the backstop.
4. **Allocate the `REC-` number** from the row-locked `document_sequences` upsert, honouring the
   business's `receipt_prefix` setting. A rolled-back payment never burns a number — the sequence
   upsert is inside the same transaction.
5. **Write the payment row and the receipt row together.** The receipt remembers the balances as
   they stood (`previous_balance`, `remaining_balance`) **and the invoice's status the instant
   before the payment landed** (`status_before`), which is what makes reversal truthful.
6. **`amount_paid` moves**; `balance_due` follows automatically (it is a generated column, so it
   cannot drift).
7. **The status follows the balance** through `applyInvoicePaymentStatus()` — see below.
8. **Audit trail on both documents** — `payment.recorded` on the payment and
   `invoice.payment_received` on the invoice, so each document's history tells its own side.

### The status machine extension

[lib/invoices.ts](lib/invoices.ts) gains the payment-driven half of the machine:

- `paymentDrivenStatus(current, balanceDueCents)` — a settled balance means **`PAID`** from *any*
  unpaid state (one payment in full works, no intermediate step); an outstanding balance on a sent
  invoice means **`PARTIALLY_PAID`**; a row already in the implied state, or a draft/cancelled row,
  returns `null` — the caller must not move it.
- `applyInvoicePaymentStatus()` — locks the row, recomputes the balance from the stored money after
  `amount_paid` was updated, writes the implied status and stamps `paid_at` **exactly once** when
  the invoice becomes `PAID`. Money is the **only writer** of `PARTIALLY_PAID` and `PAID` in the
  whole system: no staff action can set them by hand, so the stored status can never disagree with
  the money.
- `paymentReversalStatus(current, previousStatus, balanceDueCents)` +
  `applyInvoicePaymentReversal()` — the reversal half: the receipt's remembered `status_before`
  walks the invoice back down **the path it actually took** (`PAID → PARTIALLY_PAID → SENT`)
  instead of collapsing every reversal to one state; `paid_at` is cleared the moment it is no
  longer paid.

### Payment reversal (money is never deleted)

[reversePayment()](lib/repositories/payments.ts) removes the payment's amount from `amount_paid`
and restores the status — nothing else. The payment row, its receipt and both audit events **stay
on record**, so the numbers already issued to the customer (`REC-0003` on paper) remain explained.
Reversing payments in any order leaves the invoice exactly where its remaining money says it
should be.

### Receipt PDF

- [lib/pdf/receipt-document.ts](lib/pdf/receipt-document.ts) — the quote/invoice document engine
  reused for a **proof-of-payment layout**: business letterhead with the uploaded logo, a
  *Received from* block, a *Payment* block (method, reference, date), the **Amount received**
  panel, the **balance walk** (before → this payment → remaining), a **PAID IN FULL** stamp when
  the payment settled the invoice, the payment's notes, and the standard footer with page numbers.
  The renderer draws **only stored values** — the balances printed are the ones the receipt row
  remembered.
- [lib/pdf/receipt-service.ts](lib/pdf/receipt-service.ts) assembles it from
  `getReceiptDetail()` (one query: receipt + payment + invoice + customer) and the business record;
  served behind the session at `/app/payments/[paymentId]/pdf` with a `REC-0001-Customer.pdf`
  filename.
- The receipt deliberately carries **no banking details** — it proves money the business received,
  not how to pay it more.

### Screens and surfaces

- `/app/payments` — the payments list: all-time and this-month received totals in the header, each
  row showing the receipt number, method badge, customer, the invoice it settled, amount and
  status; reversal feedback alerts.
- `/app/payments/new` — the record-payment form: a select of **only invoices that can take money
  right now** (`listInvoices` UNPAID filter), with each option's balance; amount (prefilled with
  the balance), date, method (EFT/Cash/Card/Other), reference and notes. `?invoiceId=` preselects
  — the **Record payment** buttons on invoices deep-link here.
- `/app/payments/[paymentId]` — the receipt screen: balance walk, settled stamp, payment details,
  **Download receipt PDF**, open-the-invoice link, invoice status card, and the **Reverse payment**
  action with the never-deleted explanation.
- `/app/invoices/[invoiceId]` — a new **Payments card** (receipt number, date, method, reference,
  amount per payment, linking to each receipt) plus a **Record payment** action whenever the
  invoice can take money; the overdue hint now points at recording a payment.
- Customer history ([customers.ts](lib/repositories/customers.ts)) now lists each payment's
  receipt number and links to the receipt.
- Nav: **Payments** and **Record payment** lost their "P5" badges — they are live. The dashboard
  build-status card shows Phase 5 as live; the app-shell footer names payments as part of the
  shipped product.

### Migration 0009

[0009_payment_receipt_numbers.sql](db/migrations/0009_payment_receipt_numbers.sql) adds two
columns and nothing else:

- `payments.receipt_number text` + a partial unique index (one receipt per payment) — the mirrored
  number the payments screen lists without a join; the receipt row stays the authority.
- `receipts.status_before public.invoice_status` — the status the invoice had the instant before
  its payment landed, the memory that reversal walks back through.

No trigger writes statuses: the money rules live in one testable place (`lib/invoices.ts`).

### Demo seed

`npm run db:seed` now tells the full Phase 5 story on a fresh database: **INV-0001** (converted
from the accepted quote) is sent and carries a **R2 500 part payment** → `PARTIALLY_PAID` with
receipt **REC-0001**; **INV-0002** is a smaller invoice **paid in full** → `PAID` with `paid_at`
stamped and receipt **REC-0002**. Sequences continue at 3. The dashboard, payments screen, invoice
detail, receipt PDFs and every filter have real rows immediately.

---

## Verification

| Gate | Result on this machine |
| --- | --- |
| `npm run db:migrate` | **0009 applied** to the dev cluster |
| `npm run db:seed -- --force` | **rebuilt demo tenant**; INV-0001 `PARTIALLY_PAID` (R2 500 of R11 724,25), INV-0002 `PAID` with receipt rows carrying correct balances and `status_before` |
| `npm run typecheck` (`tsc --noEmit`) | **clean** |
| `npm run lint` (ESLint) | **0 errors, 0 warnings** |
| `npm run build` (`next build`) | **success** — all four payment routes compiled (`/app/payments`, `/new`, `/[paymentId]`, `/[paymentId]/pdf`) |
| Live smoke test on the boot server (production build) | `/app/payments`, `/app/payments/new`, `/app/payments/[id]`, `/app/invoices/[id]` all **HTTP 200** behind a session; the receipt PDF endpoint returns a **valid `%PDF-1.7`** whose extracted text contains the receipt number, customer, `R 2 500,00` received, `R 9 224,25` remaining and the business letterhead |
| `npm test` (Vitest, real PostgreSQL + real RLS) | **not run on this machine; no CI result is preserved in this export** — see the Phase 4 report's environment note |

### Automated tests present (execution unverified here)

- **Unit** ([tests/unit/payments.test.ts](tests/unit/payments.test.ts)) — the payment-driven
  status helpers: settled balance ⇒ `PAID` from every unpaid state; outstanding balance ⇒
  `PARTIALLY_PAID`; no move for rows already in the implied state; drafts and cancelled rows never
  move by money; reversal walks back down the remembered path, stays `PAID` when money still says
  paid, and falls back sanely when no status was remembered; the receipt document model carries
  stored balances verbatim, marks settled receipts, and compacts addresses.
- **Integration, real PostgreSQL + real RLS**
  ([tests/integration/payments.test.ts](tests/integration/payments.test.ts)) — the full
  record-payment path through the real Server Action (payment + receipt rows, `REC-0001`,
  `amount_paid`/`balance_due`, `PARTIALLY_PAID`); two payments settling the balance ⇒ `PAID` with
  a `paid_at` stamp, and one payment in full from `SENT`; per-business receipt numbering with a
  second business starting again at `REC-0001`; **overpayment refused with nothing written**;
  payments on a draft and on a cancelled invoice refused; junk form values (zero, non-numeric,
  unknown method, bad date) rejected at the schema; **reversal** restoring the balance and walking
  the status back (including the both-payments-reversed case returning the invoice to its exact
  pre-payment state) while keeping every row; the **receipt PDF** including the paid stamp and the
  partial variant without it; cross-tenant reads and cross-tenant payments refused; and the
  receipt detail query the PDF service renders from.

---

## Decisions

- **Money is the only writer of `PARTIALLY_PAID` / `PAID`.** The manual transition table never
  contained them, and the payment path bypasses it with its own locked apply — so no staff action,
  forged form or race can make the status disagree with the balance.
- **Overpayment is refused, not clamped.** The contractor should see the real balance and fix the
  amount; silently capping a payment would hide a customer's mistake (or a double EFT).
- **One payment, one receipt, one number.** The receipt is created inside the payment transaction
  and its number is allocated there too, so a payment can never exist without its numbered
  receipt, and a rolled-back payment never burns a number.
- **Reversal keeps everything.** Financial records are never deleted (the same rule as invoices
  and the audit table): the payment row, the receipt that was already printed and the audit trail
  stay, and the invoice's money simply says what is true now.
- **`status_before` lives on the receipt.** It is the only honest memory of "where the invoice was
  when this money landed", and it makes reversing payments in any order deterministic.
- **The receipt shows no banking details.** It is a proof of payment, not a payment request.

## Not in this phase

The public invoice page (`/i/[token]`, the token Phase 4 already stores) and customer-facing
receipt links; reports and CSV export, email and the official WhatsApp Business API (Phase 6);
online card/instant-EFT payments (deferred — a gateway adapter would record through this same
repository and the status transitions stay exactly where they are).
