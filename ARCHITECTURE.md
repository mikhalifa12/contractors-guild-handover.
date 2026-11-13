# Contractors Guild — Architecture

How the application is put together, why each decision was made, and where future features plug in.

---

## 1. Stack

| Layer | Choice | Version | Why |
| --- | --- | --- | --- |
| Framework | Next.js (App Router) | 15.5.26 | Server rendering + Server Actions keep validation and database access on the server; one deployable app for the public site and the workspace. |
| Language | TypeScript | 5.9.3 | Strict mode plus `noUncheckedIndexedAccess`; the pinned 5.x line is what Next 15 + ESLint officially support (TS 7 is newer than the supported range). |
| UI | React 19.1.9 + Tailwind CSS 4.3.3 | — | Utility CSS with design tokens declared once in `app/globals.css` (`@theme`). No CSS-in-JS runtime. |
| Validation | Zod 3.25.76 | — | One schema per form, shared by the Server Action and (structurally) the client error renderer. Zod 4 is deliberately not used yet: it is a breaking rewrite of the API and adds nothing Phase 1 needs. |
| Database | PostgreSQL 18 (any version ≥ 14 works) | — | Row level security is central to tenant isolation, so the isolation rule lives in the database, not only in application code. |
| Driver | `pg` (node-postgres) | 8.23.0 | Explicit SQL in a small number of repository modules; no ORM hiding the security-critical queries. |
| Tests | Vitest 3.2.7 | — | Runs the real database, real migrations and real policies. |
| Local database | `embedded-postgres` 18.4.0-beta.17 | dev only | `npm run db:setup` gives a developer a working PostgreSQL without Docker or a local install. |

### Deliberate non-choices

- **No ORM.** Tenant scoping must be visible in every query, and RLS must be exercised through a
  role that cannot bypass it. Repository modules keep SQL reviewable.
- **No Supabase JS client.** The app targets *any* PostgreSQL through `DATABASE_URL`. Supabase works
  (it is PostgreSQL); nothing in the code depends on it.
- **No external authentication provider or payment gateway.** Authentication is implemented in the
  application, and payments are staff-recorded receipts rather than online gateway transactions.
  PDF generation uses `pdf-lib` for quote, invoice and receipt documents.

---

## 2. System shape

```text
        ┌──────────────────────────── Browser (phone / tablet / desktop) ────────────────────────────┐
        │  Public marketing site   ·   Auth pages   ·   /app workspace (sidebar + bottom nav)        │
        └───────────────────────────────────────────────┬────────────────────────────────────────────┘
                                                        │ HTML / Server Action POSTs (same origin)
                                   ┌────────────────────▼────────────────────┐
                                   │ Next.js server (Node runtime)           │
                                   │  app/*  →  lib/actions/*  →  lib/repos/*│
                                   │        validation, sessions, storage    │
                                   └────────────────────┬────────────────────┘
                                                        │ pg pool, always inside a transaction
                                   ┌────────────────────▼────────────────────┐
                                   │ PostgreSQL as cg_app (NOINHERIT of power)│
                                   │  SET LOCAL app.user_id / app.business_id │
                                   │  FORCE ROW LEVEL SECURITY on all tenants │
                                   └──────────────────────────────────────────┘
```

The browser never talks to the database. There is no client-side data layer, no anon key and no
direct table access.

---

## 3. Layering

```text
app/                      Routing, layouts, page composition (server components by default)
 └─ components/            Presentation: design system, marketing sections, app shell, forms
     └─ lib/actions/       Server Actions: authenticate, validate, orchestrate, revalidate
         └─ lib/repositories/  Data access: all SQL for a domain (users, businesses, dashboard)
             └─ lib/db/        Pool, transaction context, type parsers
lib/auth/                 Password hashing, tokens, session lifecycle, current user
lib/validation/           Zod schemas (single source of truth for form rules)
lib/pdf/                  A4 document toolkit (pdf-lib) + the quote renderer
lib/storage/              File storage interface + local driver + upload validation
lib/security/             Rate limiting
lib/money.ts / numbering.ts / quotes.ts / quote-draft.ts   Pure business rules (tested in isolation)
```

Rules that keep this honest:

1. **Pages never run SQL.** They call repositories (read paths) or render forms bound to actions.
2. **Actions never accept a tenant id from input.** `requireSession()` supplies `businessId`; a
   `businessId` field in a form is ignored (and there is a test for exactly that attack).
3. **Repositories always run inside `withContext()`**, so every statement executes with the tenant
   context the RLS policies expect.
4. **Pure logic is separated from I/O** (`money.ts`, `numbering.ts` formatting, `jobs.ts` pipeline
   rules) so it can be unit-tested without a database.
5. **List screens re-read the URL, not React state.** Search, filters, sorting and paging live in
   query parameters (`?q=&status=&page=`), so results are shareable, bookmarkable and rendered on
   the server; the search box debounces into `router.replace()` for speed and still submits as a
   plain GET form without JavaScript.

---

## 4. Request lifecycle

### Signed-out request to a protected page

```text
GET /app
  → app/app/layout.tsx  → requireSession()
  → cookies() reads cg_session → SHA-256 → app.auth_find_session(token_hash)
  → no/invalid row → redirect('/login')
```

### Signed-in request

```text
1. cookie token → SHA-256 → app.auth_find_session() returns user + active business
2. guard: expiry, revocation, user active, membership present
3. defence in depth: verifyActiveMembership() re-reads business_users through RLS
4. repository call → withContext({ userId, businessId })
      BEGIN
      SET LOCAL statement_timeout = 15000
      SELECT set_config('app.user_id', $1, true)      -- bound parameters, server-side values
      SELECT set_config('app.business_id', $2, true)
      ... tenant queries, policies applied by PostgreSQL ...
      COMMIT
5. last_seen_at is refreshed at most every 5 minutes
```

### Public quote request (no session)

```text
GET /q/<token>
  → app/q/[token]/page.tsx   (outside the /app gate; the token is the credential)
  → markPublicQuoteViewed(token)  → app.public_quote_mark_viewed()   [SENT → VIEWED, audit row]
  → getPublicQuote(token)         → app.public_quote()               [one jsonb document]
  → render read-only document + accept/decline form

POST /q/<token>  (Server Action)
  → zod parse (token, decision, name, reason)
  → rate limit per IP (12 responses / 15 minutes)
  → respondToPublicQuote()  → app.public_quote_respond()  [records name, time, IP; audit row]
  → revalidatePath('/q/<token>')
```

The page never queries tenant tables and never accepts a price: it renders what the definer function
returned, and the only write it can cause is the acceptance or decline of that single quote.

### Server Action (form submit)

```text
form → action(previousState, formData)
  → rate limit (where relevant)
  → zod parse → field errors returned as state (never thrown at the user)
  → requireSession() (for workspace actions) → repository → commit
  → revalidatePath() and/or redirect()
```

Failures are returned as an `ActionState` (`status`, `message`, `fieldErrors`). Unexpected
exceptions are logged server-side and replaced with a safe message — internals never reach the
browser.

---

## 5. Route structure

| Route | Rendering | Notes |
| --- | --- | --- |
| `/` `/services` `/about` `/contact` `/request-quote` | Dynamic (session-aware header) | Public; never depends on the database being up (fails safe to "signed out"). |
| `/login` `/register` `/forgot-password` `/reset-password` | Dynamic | Redirects signed-in users to `/app`. |
| `/app`, `/app/onboarding`, `/app/settings{,/documents,/banking,/profile}` | Dynamic | Requires a session; gets business context from it. |
| `/app/customers{,/new,/[customerId],/[customerId]/edit}` | Dynamic | Customer list, create, detail with history, edit (Phase 2). |
| `/app/catalogue{,/new,/[itemId]/edit}` | Dynamic | Products & services catalogue (Phase 2). |
| `/app/jobs{,/new,/[jobId],/[jobId]/edit}` | Dynamic | Job pipeline with status transitions (Phase 2). |
| `/app/quotes{,/new,/[quoteId],/[quoteId]/edit}` | Dynamic | Quote list, builder, document detail with actions and history, draft editor (Phase 3). |
| `/app/quotes/[quoteId]/pdf` | Route handler | Renders the stored quote as a PDF for the signed-in business. |
| `/q/[token]` | Dynamic | **Public** quote page: read-only document plus accept/decline. No session: the token is the credential. |
| `/q/[token]/pdf`, `/q/[token]/logo` | Route handler | The same document as PDF, and the business's logo, for whoever holds the token. |
| `/app/invoices{,/new,/[invoiceId],/[invoiceId]/edit,/[invoiceId]/pdf}` | Dynamic | Invoice list, builder, document detail, draft editor and the tax-invoice PDF (Phase 4). |
| `/app/payments{,/new,/[paymentId],/[paymentId]/pdf}` | Dynamic | Payments list, record-payment form, receipt detail and the receipt PDF (Phase 5). |
| `/app/reports` (+ `/new`) | Dynamic | Phase placeholder that states what is missing (Phase 6). |
| `/api/businesses/[businessId]/logo` | Route handler | Session + tenant check, then streams the private file. |

`/app` is reserved through a route folder named `app/app`, which keeps the public site and the
workspace in one deployable while giving contractors the requested URL shape. `middleware.ts` only
gates `/app`; `/q/<token>` is deliberately outside that gate because the customer has no account,
and the page itself does no privileged work — every read and write goes through a `SECURITY DEFINER`
function that takes the token (see [DATABASE.md](DATABASE.md)).

---

## 6. Design system

- **Tokens** live in `app/globals.css` under `@theme`: `ink-950…600` surfaces, `paper`/`steel`
  text, `ember` accents, `signal-*` semantics, plus display typography and radii. Tailwind
  generates utilities from them, so a palette change is a one-file change.
- **Component classes** (`cg-card`, `cg-input`, `cg-badge*`, `cg-divider`, `cg-texture`,
  `cg-display`) encode the industrial look without repeating long class strings.
- **Brand mark** is inline SVG (`components/brand/logo.tsx`): a shield with a lightning bolt. No
  image request, crisp at every size, and swappable in one place.
- **Accessibility & mobile**: 48px minimum form/tap targets, 16px input font (prevents iOS zoom),
  visible focus rings, `prefers-reduced-motion` honoured, pinch-zoom allowed, safe-area padding for
  the mobile bottom bar.
- **Navigation**: fixed sidebar ≥768px; below that a bottom bar with Dashboard/Customers/Quotes/
  Invoices plus a "More" drawer containing every section, and a persistent **+ Create** action.

---

## 7. Business rules that must not drift

**Money (`lib/money.ts`)** — amounts are integer cents; quantities allow three decimals; rounding
is half-up per line; discount applies before tax; document totals are the sum of rounded lines. The
database stores `NUMERIC(14,2)`, so the same numbers survive a round trip. The quote PDF renders the
stored line values — it never recalculates them — and an integration test asserts the rendered text
against the stored totals.

**Numbering (`lib/numbering.ts`)** — a single `INSERT … ON CONFLICT DO UPDATE` takes a row lock on
`(business_id, doc_type)`, so concurrent quote creation can never reuse a number, and unique
constraints on the document tables are the backstop. Prefixes come from business settings; changing
a prefix affects future documents only.

**Sessions (`lib/auth/*`)** — 256-bit random tokens, SHA-256 at rest, 30-day sliding validity,
revocation on sign-out, on password reset and for all other devices on password change.

**Quote → invoice (`lib/actions/invoices.ts`, `lib/repositories/invoices.ts`)** — conversion runs in
one transaction, copies the accepted quote's customer snapshot, lines and stored totals, marks the
quote `CONVERTED`, and relies on the partial unique index for idempotency. Draft invoices may be
edited; issued invoices are immutable financial documents.

**Payments and receipts (`lib/actions/payments.ts`, `lib/repositories/payments.ts`)** — recording a
payment locks the invoice, rejects overpayment, updates `amount_paid` and the money-derived invoice
status, allocates a receipt number and creates the receipt atomically. Reversal retains the payment,
receipt and audit history while restoring the prior balance/status path.

**Document PDFs (`lib/pdf/`)** — quote, invoice and receipt renderers consume stored document values
and shared A4 layout primitives. They do not recompute financial totals while rendering.

---

## 8. Future extension points

| Future feature | Where it plugs in |
| --- | --- |
| **AI assistant** | Tools call the repository layer with an explicit tenant context; the assistant never receives SQL access. Suggested prompts map to repository functions (`getDashboardSummary`, `createQuote`…). Permission gates and audit events already exist. |
| **WhatsApp Business API** | `lib/whatsapp.ts` currently builds click-to-chat links only (planned officially only, to avoid bans). An official adapter slots in beside it; document send/reminder events become rows in `audit_events` with the same patterns. |
| **Email** | A `Mailer` interface next to `lib/storage`; password reset currently returns the link in development instead. |
| **Online payments** | `payments.method` is an enum (`EFT`, `CASH`, `CARD`, `OTHER`); a gateway adapter records payments through the same repository, and invoice status transitions stay in one place. |
| **Multiple users / staff** | `business_users` already carries role (`OWNER`, `ADMIN`, `STAFF`, `VIEWER`) and status; RLS keys off membership, so adding invited staff is a UI + policy-refinement task, not a schema change. |
| **Public invoice and receipt delivery** | Invoice and receipt tokens are stored, but no customer-facing `/i/[token]` or receipt-delivery surface is implemented. Any public reader must use a fixed-shape, token-scoped boundary like the quote functions. |
| **Reports and exports** | Existing tenant-scoped repositories and invoice/payment indexes support Phase 6 reporting; report queries and CSV export are not implemented. |
| **Expenses, recurring invoices, statements** | New tables follow the tenant policy template (`app.apply_business_scope_policies`); no changes to the isolation model. |
| **Object storage** | Implement `StorageDriver` (save/read/remove) and switch `STORAGE_DRIVER`; feature code is unaffected. |

---

## 9. Testing architecture

- `tests/helpers/global-setup.ts` provisions the database once per run (external `TEST_DATABASE_URL`
  or the embedded cluster), applies migrations and truncates tenants. Test files and helpers are part
  of the TypeScript project, so `npm run typecheck` checks them like application code.
- `tests/helpers/env.ts` configures the environment to point at the **test** database and exposes
  admin helpers used only for verification.
- Server Actions are executed directly with the Next.js request APIs mocked
  (`tests/helpers/next-mocks.ts`), so the real code path — validation → RLS → commit → cookie —
  runs in-process without a web server.
- Integration tests assert on failures as well as successes: cross-tenant reads must return zero
  rows, cross-tenant writes must raise an RLS error, deletes must affect nothing.

Historical Phase 3 evidence records 160 tests passing (`npm test`), `tsc --noEmit` clean, ESLint clean,
`next build` producing 41 routes, and a live check of the running server — every workspace page
returns 200 with a session, `/app/quotes/<id>/pdf` returns a PDF, `/app` redirects when signed out,
and the public quote page, its PDF and its accept form were exercised end to end against the
development database (the acceptance landed with the submitted name, timestamp and IP).

Phase 4 and Phase 5 implementation reports record typecheck, lint, build and targeted smoke checks.
Their database-backed Vitest suites are present but were not run in the recorded environment, and
this export contains no CI workflow or preserved CI result. A clean release gate must therefore run
typecheck, lint, the full suite against a disposable PostgreSQL database, build and route/PDF smoke
checks before handover approval.

## 10. Deferred decisions

- **Auth provider**: local credentials keep Phase 1 self-contained; `users.password_hash` can hold
  an argon2id string later, and `passwordHashNeedsUpgrade()` already detects weaker parameters.
- **Company currency**: `businesses.currency_code` exists and flows to the UI; only ZAR formatting
  is exercised so far.
- **Time zone**: dates are stored as `DATE`/`TIMESTAMPTZ` and rendered in en-ZA; per-business time
  zones become relevant with scheduled jobs and reminders (Phase 2/6).
