# Phase 4 report — invoices, quote conversion and the invoice PDF

Phase 4 of the Contractors Guild build: **invoices**, the **one-click quote → invoice
conversion**, the **branded tax-invoice PDF** and **overdue tracking**. No table, column or
constraint from Phases 1–3 was changed or removed.

---

## What was delivered

### Invoices

- **Invoice repository** ([lib/repositories/invoices.ts](lib/repositories/invoices.ts)) — list with
  search / status filters / paging (`ALL`, `UNPAID` plus every status), detail with items, customer,
  job and source quote, status counts, and money summaries driven by the **generated
  `balance_due` column**, so outstanding can never drift from the stored rows.
- **Invoice lifecycle** ([lib/invoices.ts](lib/invoices.ts)) — `DRAFT → SENT → VIEWED` plus
  `PARTIALLY_PAID` / `PAID` (reserved for Phase 5's payment writes), `OVERDUE` and `CANCELLED`,
  enforced server-side with a row-locked `applyInvoiceStatus()`. Only a draft can be edited; a sent
  invoice is the document the customer owes against.
- **Overdue tracking is derived, not stored** — an unpaid invoice past its `due_date` is *reported*
  as `OVERDUE` everywhere (`effectiveInvoiceStatus()`, the SQL counts, the list filter), while the
  stored status stays honest. Phase 5's payment path writes the authoritative transitions.
- **Manual invoice builder** — same line-item engine as quotes (catalogue or free text, per-line
  discount and VAT), totals recomputed **on the server** from the validated lines; a browser-supplied
  total is ignored and a tampered line payload is rejected by the schema.
- **Per-business numbering** — `INV-0001` from the row-locked `document_sequences` upsert inside the
  creation transaction; sequences are independent per business.

### One-click quote → invoice conversion

- [convertInvoiceFromQuote()](lib/repositories/invoices.ts) runs in one transaction:
  1. lock the quote row; **only `ACCEPTED` can convert**
  2. clone the quote's lines and header snapshot onto a new draft invoice — **verbatim stored
     values, never recomputed**, so the invoice cannot disagree with what the customer accepted
  3. allocate the next `INV-` number from the per-business sequence
  4. mark the quote **`CONVERTED`** and stamp `converted_invoice_id`
- **Double-click safe**: the `invoices_quote_unique_idx` partial unique index (from the original
  schema) plus the guarded `update ... where status = 'ACCEPTED' and converted_invoice_id is null`
  means a second click is refused with a clear `already_converted` error, never merged or duplicated.
- The manual create path **ignores a `quoteId` posted from the browser** — the only route from a
  quote to an invoice is the conversion action, so a forged form cannot hijack a quote.
- The accepted quote's seam is now the real button: **Convert to invoice** on the quote detail page
  ([quote-actions.tsx](components/quotes/quote-actions.tsx)).

### Invoice PDF

- [lib/pdf/invoice-document.ts](lib/pdf/invoice-document.ts) — the quote document engine reused for
  a **tax invoice layout**: business letterhead with the uploaded logo and VAT/registration numbers,
  bill-to block, site/job block, itemised table, totals block with **Amount paid / Balance due**
  rows (fed by the generated column), banking details and payment instructions from the business
  record, payment terms, terms and conditions, footer note, page numbers, multi-page flow with a
  repeated table header, and a **PAID IN FULL** / **CANCELLED** stamp panel.
- Renders stored values only — the PDF never recalculates money. Served behind the session at
  `/app/invoices/[invoiceId]/pdf` ([route.ts](app/app/invoices/[invoiceId]/pdf/route.ts)).

### Screens and surfaces

- `/app/invoices` — searchable list with status chips (including **Unpaid** and the derived
  **Overdue**), money summary header (outstanding / overdue), pagination.
- `/app/invoices/new` — manual builder; `?quoteId=` prefills from a quote with an explicit notice
  that saving creates a *separate draft* and the one-click conversion (with the audit trail) happens
  on the accepted quote itself.
- `/app/invoices/[invoiceId]` — detail with lines, totals, balance due, send/cancel actions, PDF
  download, customer block and history. `/edit` for drafts, with a locked notice on sent invoices.
- Invoices now appear in the customer's history with links, the sidebar and the **+ Create** menu
  (the P4 badge is gone), and the dashboard build-status card shows Phase 4 as live.
- Demo seed (`npm run db:seed`) now converts the accepted demo quote into `INV-0001` with its lines,
  so the invoices screen, dashboard figures and PDF all have a real row on a fresh seed.

### Migration 0008

[0008_draft_invoice_lines.sql](db/migrations/0008_draft_invoice_lines.sql) adds one policy: a
DELETE policy on `invoice_items` limited to lines of a **DRAFT** invoice (mirroring the 0006 quote
policy). Sent invoices' lines are immutable at the database level. Nothing else changed.

---

## Verification

| Gate | Result on this machine |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit`) | **clean** |
| `npm run lint` (ESLint) | **0 errors, 0 warnings** |
| `npm run build` (`next build`) | **success — 45 routes + middleware**, all six invoice routes compiled (`/app/invoices`, `/app/invoices/new`, `/app/invoices/[invoiceId]`, `/edit`, `/pdf`) |
| Unit-level logic check | invoice status machine (legal/refused transitions, overdue derivation, draft-only editing) and the invoice document model verified by direct execution — all assertions passed |
| `npm test` (Vitest, real PostgreSQL + real RLS) | **not run on this machine; no CI result is preserved in this export** — see the environment note below |

### Environment note (why the DB suite did not run here)

This Windows machine runs **AVG Antivirus plus a second engine (Reason Cybersecurity)** whose
process injection kills PostgreSQL child processes at spawn (`0xC0000142`), making any
database-backed test run impossible while the shields are up — including after the user added
folder exceptions and attempted a temporary disable. The machine is also memory-constrained
(~600 MB free; AVG alone holds ~450 MB). Fixes made along the way, all inside the dev-only scripts
and beneficial on any Windows machine:

- `scripts/lib/postgres.mjs` — resolves the binary package as `@embedded-postgres/windows-x64`
  (the published name), points `unix_socket_directories` at the data directory (no `/tmp` on
  Windows), replaces the hanging `pg_ctl -w` with a TCP readiness poll, and starts the local
  cluster with a low-memory profile (`io_method=sync`, small buffers, no autovacuum, no parallel
  workers) so children fit inside a tight commit budget.
- `scripts/db.mjs` — awaits the now-async `start()`.

On a clean development or CI host, the standard gate must be run unchanged:
`npm run db:setup && npm test`.

### Automated tests present (execution unverified here)

- **Unit** ([tests/unit/invoices.test.ts](tests/unit/invoices.test.ts)) — the invoice status
  machine (which transitions are legal and which are refused, overdue derivation from the due date,
  draft-only editing) and the invoice document model (stored values pass through untouched,
  paid/cancelled labels, banking details carried, settings-less fallbacks).
- **Integration, real PostgreSQL + real RLS**
  ([tests/integration/invoices.test.ts](tests/integration/invoices.test.ts)) — manual invoices with
  server-calculated totals and per-business numbering; tampered browser totals ignored and
  impossible lines rejected; draft-only edits with the lines locked after sending; public-token
  creation on send with a second send refused; cancellation and the closed-record rule; overdue
  reported from the due date without a stale stored flag; the **full conversion lifecycle** through
  the real Server Actions (verbatim lines and totals, `CONVERTED` stamp, audit trail on both
  documents); **second conversion refused** (double-click safety); conversion of a non-accepted
  quote refused; forged `quoteId` on the create form ignored; cross-tenant reads, sends and
  conversions refused; and the PDF renderer including a foreign-tenant refusal.

---

## Decisions

- **The invoice is a copy, not a reference.** Conversion clones the quote's stored lines and totals.
  A quote can never change after acceptance anyway, but the copy also survives customer-record
  edits, keeps the invoice readable as a standalone document, and matches how accountants expect a
  tax invoice to behave.
- **`OVERDUE` is derived.** Storing it would invite stale flags; every surface derives it from
  `due_date` via one pure function and the same predicate in SQL. The Phase 5 payment path remains
  the only writer of authoritative money statuses.
- **`PARTIALLY_PAID` and `PAID` are wired but inert.** They exist in the enum, the machine and the
  badge colours; only Phase 5's payment recording can reach them.
- **The public invoice page is a future seam.** Sending a draft invoice already creates its
  192-bit public token (stored, unused), exactly like quotes before Phase 3's `/q/[token]` page.
  Phase 5 did not add the public invoice route; it remains deferred.
- **Banking details come from the business settings**, never from the quote — the invoice is the
  document the customer pays from.

## Not in this phase

Payments, partial payments and receipts (Phase 5); the public invoice page (`/i/[token]`, deferred);
reports and CSV export, email and the official WhatsApp Business API (Phase 6); Playwright
end-to-end coverage, hardening and multi-staff (Phase 7). The payments screens remain honest
placeholders that name what is missing.
