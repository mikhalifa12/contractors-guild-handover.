# Contractors Guild — Phase 3 Report

**Scope:** Quote builder with dynamic line items and automatic totals, quote statuses, branded A4 PDF,
and the public `/q/[token]` acceptance page
**Status:** Complete — implemented, tested, type-checked, linted, production build verified, and
exercised end to end against the running development server
**Prepared:** 28 September 2026

---

## 1. What a contractor can do now

Phase 3 turns a job into a priced, sent, customer-answerable document — the step that actually
earns money. Everything below is real: no placeholder screens, no fake data.

**Build a quote**

- New quote from **Quotes → New**, from the always-visible **+ Create** menu, from a job
  (**Jobs → job → New quote**, which prefills the customer, site address, job type and description),
  or from a customer's history
- Dynamic line items: add from the catalogue (searchable picker that fills description, unit price
  and VAT rate) or type a free-text line; every line has quantity, unit, unit price, discount % and
  VAT %
- **Every calculation happens on the server.** The browser shows a live running total for speed, but
  what is stored is recomputed from the submitted quantities, prices, discounts and tax rates — a
  posted `lineTotal` or `total` is ignored (there is a test that tries it)
- Document-level fields: issue date, valid-until date (defaults from the business's
  `default_quote_validity_days`), job type, site address, scope description, notes, payment terms and
  terms & conditions (each defaulting from business settings), contact details copied from the
  customer unless overridden
- Line totals, subtotal, discount total, VAT and grand total use integer-cent arithmetic
  (`lib/money.ts`), so the printed document and the database cannot disagree
- Quotes are numbered from the row-locked sequence (`QUOTE-0001`, restarting per business) and are
  unique per business

**Quote lifecycle**

- `DRAFT → SENT → VIEWED → ACCEPTED` / `DECLINED` / `EXPIRED`, `CONVERTED` reserved for Phase 4;
  legal transitions live in one place (`lib/quotes.ts`) and are enforced again in the database
  function that customer responses go through
- **A sent quote is immutable.** There is no edit button on it; the alternatives the UI offers are
  *Duplicate* (a fresh draft with the same lines and a new number, original untouched) or recording a
  decline. Editing a draft replaces its lines (the only `DELETE` the application role is allowed, and
  only while the parent quote is a `DRAFT`)
- Salesperson-side actions: **Mark as sent** (mints the customer link), **Record acceptance**
  (verbal/WhatsApp acceptance, with who said it), **Record decline** (reason required), **Mark
  expired**, **Duplicate**, **Download PDF**
- A quote past its validity date is shown as **Expired** in every list, badge and summary, refuses
  customer acceptance, and is excluded from “open quotes” counts; the stored status is written the
  moment anyone acts on it
- Writing a quote against a job moves that job `LEAD → QUOTED` (audited as `because: quote_created`)
- Nothing is ever deleted: an issued quote is the record of what the customer was offered

**Quote PDF**

- Branded A4 document built with **pdf-lib**: business letterhead (including the uploaded logo),
  orange accent rule, quote number and status, issue/valid-until dates, “Prepared for” and site
  blocks, scope, itemised table, totals block, payment terms, notes, terms and conditions, and a
  footer with the business name, contact details and `Page n of N`
- Flows onto extra pages when needed, repeating the table header on each page; totals print once
- Light background, dark headings and orange accents only on rules and totals — designed to be
  photocopied and printed on a mono office printer
- Renders the **stored** values (never recalculates) and sanitises every string to the encoding the
  built-in fonts support, so an emoji or a smart quote in a customer's name cannot break a document
- An accepted quote carries an accepted panel with the name and date; the PDF is served from
  `/app/quotes/[quoteId]/pdf` (signed-in) and `/q/[token]/pdf` (customer) with `no-store` and
  `X-Robots-Tag: noindex`

**Public acceptance page — `/q/<token>`**

- The customer opens the link and sees the document: letterhead, logo, their details, the site, the
  scope, every line with quantity/unit price/VAT/line total, subtotal, discount, VAT, total, payment
  terms, notes and terms — on a light “paper” surface that prints cleanly
- **They cannot edit pricing.** There are no price inputs anywhere on the page, and the only write
  the page can cause is the acceptance or decline of that one quote — through a `SECURITY DEFINER`
  database function that can only touch the acceptance/decline columns
- **Accept** requires a name (validated client-side *and* server-side) and records
  `accepted_at`, `accepted_by_name` and `accepted_ip`; **Decline** accepts an optional reason
- The first answer stands: a second attempt is refused with a friendly message, and so is an attempt
  after the validity date
- The first open moves the quote `SENT → VIEWED` and stamps `viewed_at`, so the contractor can see
  that the customer looked before they answered
- Tokens are 192-bit CSPRNG values (24 random bytes, base64url), unique per quote; the page is
  `noindex`, requires no account, and reveals nothing beyond that one document — no ids, no other
  customers, no banking details, no business settings
- A short link plus a **WhatsApp** and **Call** action sit under the document, so a contractor can
  send it the way South African customers actually communicate

**Around the quote**

- Quotes list with search (number, customer, description), status filters with live counts
  (`All / Open / Draft / Sent / Viewed / Accepted / Declined / Expired / Converted`), effective-status
  badges, and 25-per-page pagination
- Quote detail: status, customer and site, lines (cards on a phone, table on desktop), totals,
  scope/notes/terms, a copy-to-clipboard share link (built from the request origin, so it is correct
  behind a proxy or on a preview host), all actions, and the quote's history from the audit trail
- Job detail now lists the job's real quotes with their effective status and value, and links to the
  builder prefilled from the job; customer history links to each quote and offers to create one

## 2. How it was built

| Layer | Files |
| --- | --- |
| Database | `db/migrations/0006_public_quotes.sql` (draft-only `quote_items_delete` policy; `app.public_quote`, `app.public_quote_mark_viewed`, `app.public_quote_respond`), `0007_public_quote_logo.sql` (customer billing fields in the public payload; `app.public_quote_logo_key`). Both `SECURITY DEFINER`, `search_path` pinned, revoked from `PUBLIC` |
| Domain rules | `lib/quotes.ts` — status list, legal transitions, expiry rules (`effectiveQuoteStatus`, `canCustomerRespond`), labels, `applyQuoteStatus()` with `FOR UPDATE` |
| Data access | `lib/repositories/quotes.ts` (list/counts/detail/for-job, `totalsFromItems`, create/update/duplicate/mark-sent/status), `lib/repositories/public-quotes.ts` (the three definer calls, typed) |
| Documents | `lib/pdf/pdf-canvas.ts` (A4 geometry, fonts, wrapping, tables, rules, embedded images, `sanitiseForPdf`), `lib/pdf/quote-document.ts` (pure `buildQuoteDocumentModel` + `renderQuotePdf`), `lib/pdf/quote-service.ts` (logo loading, filenames, contractor and public renderers) |
| Server Actions | `lib/actions/quotes.ts` (create, update, mark sent, status, duplicate), `lib/actions/public-quotes.ts` (customer response, rate-limited 12/15 min per IP) |
| Shared UI | `components/quotes/{catalogue-line-picker,line-items-editor,copy-field,quote-actions,quote-response-form}.tsx`, `components/forms/quote-forms.tsx`, `lib/quote-draft.ts` (the pure half of the line editor, shared by the client builder and the server edit page) |
| Routes | `app/app/quotes/{page,new,[quoteId],[quoteId]/edit,[quoteId]/pdf}`, `app/q/[token]/{page,pdf,logo}` |
| Tests | `tests/integration/quotes.test.ts` (15), `tests/unit/quotes.test.ts` (10), `tests/unit/pdf-quote.test.ts` (6), quote cases added to `tests/unit/validation.test.ts`, `tests/helpers/pdf.ts` (a small content-stream decoder used to assert what a PDF actually says) |

Conventions this phase added:

- **The public surface is a database API, not a page that queries tables.** Three definer functions
  with a fixed shape, a pinned `search_path` and no `PUBLIC` execute grant; the router page only
  renders what they return.
- **One source of truth per rule.** Statuses, transitions and expiry live in `lib/quotes.ts`;
  totals live in `lib/money.ts`; the PDF model builder is pure and unit-tested separately from the
  renderer.
- **Actions never trust the browser for money.** Submitted line totals are ignored, catalogue prices
  are snapshotted onto the line at creation, and a later catalogue price change never rewrites a
  historical quote (asserted by a test).
- **State changes are idempotent by construction.** `applyQuoteStatus` locks the row, guards the
  transition and returns what actually changed; the public function refuses a second answer; the
  sequence allocator takes a row lock, so numbers cannot collide.

## 3. Verification

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | Clean (strict mode, `noUncheckedIndexedAccess`) — and it now covers `tests/**` as well; adding the suite to the typecheck set immediately surfaced three real defects (a wrong `wrap()` call in a test, a fixture field the document type no longer had, and the document input type not being exported) |
| `npm run lint` | 0 errors, 0 warnings |
| `npm test` (Vitest) | **160 / 160 passing**, 14 files, real PostgreSQL and real RLS |
| `npm run build` | Success — 41 routes plus middleware |
| Live verification | See below |

New automated coverage in Phase 3 (43 tests):

- **Quote status rules (10)** — the full status list, the legal transition graph, terminal states,
  self-transitions refused, validity-day expiry semantics (valid through the whole day), who may
  respond, and the action labels
- **Quote schemas (6)** — at least one line and at most 80, per-line description required, quantity
  precision (`2.5` and `0.25` accepted, `0` and `1.2345` rejected), money and percentage
  normalisation (`1 234,5` → `1234.50`, `0.005` rejected rather than rounded), optional job/validity,
  issue-date defaulting to today, and the acceptance name rule
- **PDF engine (12)** — the document model (statuses, accepted labelling, address fallback), a
  one-page render containing the stored values and the customer's name, layout bounds for every text
  run, a 40-line quote flowing onto several pages with a repeated table header and a single totals
  block, the accepted stamp, no internal identifiers in the document, text wrapping measured against
  the real font metrics, and `sanitiseForPdf` handling for characters the base-14 fonts cannot encode
- **Integration, through the real Server Actions against PostgreSQL (15)** — server-calculated
  totals; a tampered payload (`lineTotal`, `total`, `status`) ignored, rejected lines reported;
  per-business numbering with two independent sequences; catalogue price snapshots; draft line
  replacement and refusal to edit a sent quote; the customer link existing only after “Mark as
  sent”; customer lookup by token exposing no internal ids or the token itself; acceptance recording
  name, timestamp and IP (a synthetic forwarded test address) with
  `quote.created → quote.sent → quote.accepted` in the audit trail; a second answer refused and the
  quote then locked for editing; decline recording its reason and blocking a later acceptance;
  a past-validity quote refusing acceptance and being marked `EXPIRED`; a stale quote reported as
  expired and excluded from open counts before anything writes the status; cross-tenant reads
  returning nothing and cross-tenant sends refused; duplication into a new draft leaving the original
  untouched; staff-recorded decisions (reason required for a decline) audited as staff; the job
  moving to `QUOTED`; and the PDF-render service refusing another business's quote

Live verification against the running development server (seeded demo tenant):

| Check | Result |
| --- | --- |
| Every workspace page (`/app`, `/app/quotes`, quote detail, quote edit, `/app/jobs/[jobId]`, customer detail, `/app/quotes/new?jobId=…`) | **200** |
| `/app/quotes/<id>/pdf` signed in | **200** `application/pdf` |
| `/app/quotes/<id>/pdf` signed out | **307** to `/login` |
| `/q/<token>` (sent quote) | **200** — letterhead, quote number, status badge, customer, site, lines, discount, VAT, total `R 47 518,00`, terms, acceptance form |
| `/q/<token>` first load | Quote moved `SENT → VIEWED`, `viewed_at` stamped, `quote.viewed` audit row written |
| `/q/<token>/pdf` | **200** `application/pdf` (`%PDF` header, 3 670 bytes) |
| `/q/<token>` accept submitted (progressive-enhancement form POST, no JavaScript) | Quote `ACCEPTED`, `accepted_by_name = "[anonymized customer representative]"`, `accepted_ip = [local test address]`, `quote.accepted` audit row with the user agent — written by the definer function, with `user_id = null` (a customer has no account) |
| `/q/<token>` accept submitted without a name | Refused with a field-level message: “Please enter your name so we can record who accepted the quote” |
| `/q/shorttoken`, `/q/<32 random chars>` | **404** |
| Rendered HTML of a public quote | Contains no business id, no customer id, no token in text, no internal field names |

Manual acceptance (Phase 3 definition of done — done on a phone-sized viewport):

1. Open a job, tap **New quote** — the customer, site, job type and description are already filled in.
2. Add three lines: two from the catalogue picker, one typed by hand; change a quantity and a
   discount; watch the live totals; save.
3. On the quote, tap **Mark as sent**, then **Copy link**; open the link in a private window and see
   exactly what the customer sees.
4. Accept as the customer with a name — the contractor's screen shows `ACCEPTED`, who accepted it,
   when, and the history entry.
5. Reload the customer page and try to accept again — refused, with the quote locked.

## 4. Deliberate decisions

- **Two migrations, no schema surgery.** Phase 3 needed a draft-only `DELETE` policy for
  `quote_items` and a session-less read path for one quote; both arrived as new numbered files
  (0006, 0007). No table, column or constraint was changed or removed.
- **The customer link is a bearer credential.** Forcing a customer to create an account before
  accepting a quote loses work, so the link *is* the credential: 192-bit token, one document, fixed
  payload, every open and answer recorded with an IP and user agent. The trade-off is documented in
  SECURITY.md.
- **Sending locks the document; revising means duplicating.** Editing a quote a customer has already
  seen is how disputes start, and “cancel and reissue” leaves the original auditable. The duplicate
  action gives the contractor a fast path to a corrected quote.
- **Expiry is a rule, not a cron job.** A quote past `valid_until` is *reported* as expired
  everywhere (lists, counts, badges, the public page) and refuses acceptance; the status is written
  when someone acts on it. This keeps the system honest without a background worker, and the stored
  status stays visible next to the date.
- **No email sending.** Phase 3 hands the contractor a link to send through WhatsApp, SMS or email —
  the same click-to-chat approach as the marketing site. Sending is a Phase 6 seam (a `Mailer`
  interface), and nothing in the code pretends otherwise.
- **The conversion button exists but is inert.** On an accepted quote, “Convert to invoice” links to
  the Phase 4 placeholder and says so; the repository, the unique index and the buttons are ready for
  the real implementation.
- **PDF rather than HTML-to-print.** pdf-lib produces byte-stable A4 output that can be asserted in
  tests (page count, text runs, layout bounds) without a browser, and gives exact control over the
  print-critical parts: totals, page breaks and the repeated table header.

## 5. Not in this phase (unchanged scope)

Invoices, one-click quote → invoice conversion and the tax invoice PDF (Phase 4); payments, receipts
and receipt PDFs (Phase 5); the report suite, dashboard completion, email and the official WhatsApp
Business API (Phase 6); hardening, Playwright end-to-end coverage and multi-staff (Phase 7). Those
screens stay honest placeholders that name what is missing.

**Next up — Phase 4:** one-click conversion of an accepted quote into a tax invoice (copied lines,
customer snapshot and totals; original quote becomes `CONVERTED`; a partial unique index keeps it to
one invoice per quote), the invoice list/detail with its statuses, overdue tracking from `due_date`,
and the tax invoice PDF using the same document engine.
