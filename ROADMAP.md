# Contractors Guild — Roadmap

The product plan runs in seven phases. Implemented work is separated from planned work, and the
release evidence for each phase is recorded independently.

**Current status: Phases 1–5 are implemented.** Phase 3 has a recorded full database-backed test run.
Phases 4 and 5 have implementation reports and automated tests, but their database-backed suites
were not run in the recorded development environment and must be rerun before release. Phases 6 and
7 remain planned.

Required release gate for every phase:

1. `npm run typecheck` — clean
2. `npm run lint` — clean
3. `npm test` — all unit + integration tests pass against real PostgreSQL
4. `npm run build` — production build succeeds
5. Manual smoke test of every new route on a desktop and a narrow (phone) viewport
6. A short written report of what was added, what was verified and what is deliberately deferred

---

## Phase 1 — Foundation, authentication, business onboarding ✅ Complete

**Delivered**

- Repository architecture (App Router, typed layers, repository pattern — no SQL in components)
- PostgreSQL schema for the whole product: 17 tables, enums, constraints, indexes, generated
  `balance_due`, `updated_at` triggers — see [DATABASE.md](DATABASE.md)
- Row level security: tenant policies on every business-owned table, `FORCE ROW LEVEL SECURITY`,
  security-definer auth helpers, append-only audit trail
- Contractors Guild design system: dark industrial shell, burnt-orange accents, mobile-first
  layout, 48px touch targets — see [ARCHITECTURE.md](ARCHITECTURE.md#6-design-system)
- Public marketing site: home, services, about, contact and a request-a-quote page that hands off
  to WhatsApp (no unofficial WhatsApp automation)
- Authentication: registration, login, logout, forgot/reset password, profile update, password
  change with other-session revocation, rate limiting, audit events
- Business onboarding: one transactional registration that creates the user, business, owner
  membership, settings and numbering sequences; guided setup for identity, banking and logo
- Settings: business profile, logo upload (content-validated), document defaults and numbering
  prefixes, banking details stored per business
- Dashboard: live aggregates (revenue, outstanding, overdue, unpaid invoices, quotes awaiting
  acceptance, customers, jobs) plus a setup checklist driven by real rows
- Workspace shell: sidebar on desktop, bottom navigation + drawer on mobile, always-visible
  **+ Create** action, status badges, `/app` protected by middleware and a server-side session gate
- Tooling: `npm run db:setup|start|stop|status|migrate|reset|seed` — a real local PostgreSQL cluster
  with no Docker dependency, plus obviously-fake demo seed data
- Tests: automated unit + integration suite against real PostgreSQL and real RLS. Historical reports
  record 77 tests after Phase 1, 117 after Phase 2 and 160 after Phase 3. Phase 4 and 5 tests are
  present but their database-backed results are not verified in the preserved reports.
- Documentation: README, ARCHITECTURE, DATABASE, ROADMAP, SECURITY

**Not in Phase 1** (so nobody mistakes a placeholder for a feature): customers, products/services,
jobs, quotes, invoices, payments, receipts, PDFs, reports.

---

## Phase 2 — Customers, catalogue and jobs ✅ Complete

Goal: a contractor can run the day-to-day admin of their business from a phone.

**Delivered**

- **Customers** — searchable list (name, phone, email), active/archived/all filters, pagination;
  create and edit with billing plus separate job-site addresses; duplicate detection that warns and
  offers "Save anyway"; archive/restore instead of delete; detail screen with jobs, quotes, invoices
  and payments history, quick call/WhatsApp/email actions and an activity trail
- **Products & services catalogue** — one catalogue with products and services, unit pricing
  (text entry normalised to two decimals, never a float), VAT rate, cost price, category, SKU,
  archive/restore, search plus type and status filters; names unique per business
- **Jobs** — `LEAD → QUOTED → APPROVED → SCHEDULED → IN_PROGRESS → COMPLETED` plus `CANCELLED` and
  reopening; job numbers allocated from the transactional sequence and unique per business; customer
  picker with type-to-search autocomplete; site address inherited from the customer when left blank;
  scheduling date; notes; detail screen with pipeline controls, customer contact actions, documents
  section and job history. Illegal transitions are refused in the action and never written
- **Shared patterns later phases reuse** — URL-driven list state (search, filters, sort, paging),
  the searchable picker component, responsive card lists, form/field error rendering, and audit
  events for every create, update, archive and status change

Acceptance verified: customers, catalogue items and jobs are created, edited, filtered and archived
through the real Server Actions against PostgreSQL, with 40 new automated tests (117 total).

---

## Phase 3 — Quote builder, quote PDF and customer acceptance ✅ Complete

- **Quote builder** — dynamic line items from the catalogue or free text, quantity, unit, unit
  price, per-line discount and VAT, with subtotal / discount / VAT / grand total recalculated **on
  the server** from the submitted lines (browser-supplied totals are ignored); quote validity date;
  notes, payment terms and terms and conditions; customer picker plus optional job link that
  prefills the site address, job type and description
- **Quote lifecycle** — `DRAFT → SENT → VIEWED → ACCEPTED` / `DECLINED` / `EXPIRED`, `CONVERTED`
  reserved for Phase 4; a sent quote is immutable (revise by duplicating it into a new draft); a
  quote past its validity date is reported as expired everywhere and refuses acceptance
- **Quote PDF** — branded A4 document built with pdf-lib: business letterhead with the uploaded
  logo, itemised table, totals block, terms, accepted stamp, page numbers and multi-page flow;
  rendered from stored values, never recalculated
- **Public acceptance page** — `/q/[token]` with the branded document and Accept / Decline actions;
  accepting records `accepted_at`, `accepted_by_name` and `accepted_ip`; the customer can never edit
  pricing, quantities or terms; 192-bit unguessable token; reads and writes go through
  `SECURITY DEFINER` functions rather than tenant tables; responses rate-limited
- **Conversion entry point** — a clearly-labelled "Convert to invoice" seam appears on accepted
  quotes (implemented in Phase 4)
- **Beyond the plan** — per-line catalogue prices are snapshotted onto the quote (editing a
  catalogue price later never rewrites a historical quote), the job behind a quote moves to
  `QUOTED` automatically, and the demo seed now ships three quotes with a printable customer link
- Tests: 43 new automated tests (160 total) — quote status and expiry rules, quote line schemas,
  the PDF renderer (layout bounds, pagination, sanitised text, accepted stamp) and the full
  lifecycle through the real Server Actions, including tampered line payloads, second responses
  refused, expired quotes refused and cross-tenant reads and writes

Acceptance verified: five line items (catalogue and free text) were built, saved with server-computed
totals, sent, opened and accepted through the running dev server — the acceptance recorded an
anonymized customer representative, the timestamp and request metadata, and the audit
trail shows `quote.created → quote.sent → quote.viewed* → quote.accepted` for that business only.
(*A first open before acceptance moves the quote to VIEWED.)

---

## Phase 4 — Invoices and quote conversion ✅ Implemented; release verification pending

- **One-click quote → invoice conversion** — copies line items, customer snapshot and totals; the
  original quote is untouched and becomes `CONVERTED`; a partial unique index guarantees at most one
  invoice per quote, so a double-click cannot duplicate a document
- **Invoices** — TAX INVOICE layout per the supplied reference structure (business details, VAT
  number, customer, job address, line items, subtotal / discount / VAT / total, banking details from
  the business record, payment terms, footer), with `issue_date`, `due_date` and `prepared_by`
- **Invoice statuses** — `DRAFT`, `SENT`, `VIEWED`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `CANCELLED`,
  with `balance_due` taken from the generated column so outstanding can never drift
- **Invoice PDF** — same document engine as quotes, print-readable on A4
- **Overdue tracking** — driven by `due_date` for reporting rather than a stale stored flag

Acceptance target: convert a quote, confirm every line and total matches the quote exactly, download
the PDF, and print it on A4. The implementation report records build and smoke checks, but the full
database-backed test suite still requires independent rerunning.

---

## Phase 5 — Payments and receipts ✅ Implemented; release verification pending

- **Payments** — partial payments and multiple payments per invoice, EFT/cash/card/other, payment
  date, reference and notes, recorded against the invoice and customer. The invoice row is locked,
  the balance recomputed server-side and overpayment refused, never clamped
- **Automatic status transitions** — a payment smaller than the balance moves the invoice to
  `PARTIALLY_PAID`; clearing the balance moves it to `PAID` and stamps `paid_at`. Money is the only
  writer of those two statuses — no staff action can set them by hand
- **Receipts** — generated automatically for every payment with its own `REC-` number, recording
  amount received, previous balance and remaining balance, plus a branded receipt PDF
- **Payment reversal** — a recorded payment can be reversed: the balance is restored and the
  invoice walks back down the status path its receipts remember (PAID → PARTIALLY_PAID → SENT).
  Nothing is deleted — the payment, receipt and audit trail stay
- **Outstanding views** — invoice detail, payments screen, customer history and dashboard reflect
  the new balance immediately

Acceptance target: take a partial payment, verify the outstanding amount, take the final payment,
see `PAID` and a receipt, all without leaving the invoice screen. The implementation report records
build and smoke checks, but the full database-backed test suite still requires independent rerunning.

---

## Phase 6 — Reports, dashboard completion and integration seams (planned)

- **Reports** — revenue and payments, outstanding, paid and overdue invoices, quote acceptance and
  conversion rate, revenue per customer, with today / this week / this month / last month / this
  year / custom range filters and CSV export
- **Dashboard completion** — real money-in trend, activity feed, and a "needs attention" list
  (overdue invoices, quotes about to expire, unscheduled jobs)
- **Email** — pluggable `Mailer` (quote sending, invoice sending, receipts, reminders) with a
  no-send development driver so nothing is emailed by accident
- **Official WhatsApp Business API** — official integration behind the existing `lib/whatsapp.ts`
  seam (template messages for sending quotes/invoices and reminders). No automation of personal
  WhatsApp accounts, ever
- **AI assistant (read-only first)** — tools that call the repository layer with the caller's tenant
  context ("which invoices are overdue?", "how much did I quote this month?", "draft a quote for
  customer X" as a reviewable draft). The assistant never gets raw SQL access and every action is
  audited

Acceptance: date-filtered reports match raw SQL, and the assistant answers questions about the
signed-in contractor's data without ever seeing another tenant's rows.

---

## Phase 7 — Hardening, end-to-end verification and launch (planned)

- **Browser end-to-end suite (Playwright)** covering the complete journey in one test:
  register → create customer → add product → open job → build quote → quote PDF → customer views
  quote → customer accepts → convert to invoice → invoice PDF → partial payment → verify
  outstanding → final payment → status `PAID` → receipt generated → customer history shows
  everything → dashboard revenue reflects the payment
- HTTP-level attack tests (foreign ids in forms, URL tampering, token guessing, IDOR attempts)
- Performance pass with realistic row counts (10k customers, 50k documents): index review, pool
  sizing, N+1 checks and a documented slow-query budget
- Accessibility pass (keyboard, screen reader, contrast) and real-device testing on Android and
  iPhone
- Deployment hardening: production runbook, backups with a restore drill, error monitoring, log
  retention, secret rotation, branch protection and CI running typecheck/lint/test/build
- Multi-staff and multi-business switching (roles already exist in `business_users`), invitations
  and per-role permissions

---

## Explicitly deferred (designed for, not built)

| Feature | Phase | Seam that exists today |
| --- | --- | --- |
| Expenses tracking | after Phase 7 | tenant policy template + `payments`/`method` patterns to copy |
| Recurring invoices | after Phase 7 | `document_sequences` + invoice creation path |
| Customer statements | after Phase 7 | tenant-scoped reporting queries + PDF engine |
| Online payments (card/instant EFT) | after Phase 7 | `payments` table + `payment_method` enum + status transitions |
| Email delivery | Phase 6 | configuration placeholders in `.env.example` |
| Official WhatsApp Business API | Phase 6 | `lib/whatsapp.ts` (click-to-chat only today) |
| AI assistant | Phase 6 | repository layer as the only data boundary |
| Multi-staff / multi-business switching | Phase 7 | `business_users.role/status` already enforced by policies |
| Object storage for uploads | when deploying | `StorageDriver` in `lib/storage/index.ts` |
