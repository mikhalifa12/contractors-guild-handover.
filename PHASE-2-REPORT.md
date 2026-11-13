# Contractors Guild — Phase 2 Report

**Scope:** Customers, products & services catalogue, and jobs
**Status:** Complete — implemented, tested, type-checked, linted, production build verified
**Prepared:** 28 September 2026

---

## 1. What a contractor can do now

Phase 2 turns the Phase 1 shell into a working back office. Everything below writes to real
PostgreSQL through Server Actions, scoped to the signed-in business by row-level security.

**Customers**

- Search the list by name, phone or email; filter active / archived / all; 25 per page
- Create and edit with customer type (business or individual), contact name, phone, email,
  VAT number, billing address and a separate job‑site address
- Duplicate detection: matching name or phone warns before saving and offers **Save anyway** —
  never blocks a legitimate second record
- Archive and restore instead of delete (no `DELETE` policy exists on tenant tables)
- Customer detail: job, quote and invoice counts with paid and outstanding totals, tap-to-call, WhatsApp deep link and
  email actions, both addresses, notes, jobs/quotes/invoices/payments history and an activity trail
- Delete-proof by design: history stays readable after archiving

**Products & services catalogue**

- One catalogue for products and services (`kind = PRODUCT | SERVICE`), price, unit, VAT rate,
  cost price, category, SKU, description, archive/restore
- Money is typed as text (`1 234,5` is accepted) and normalised to `1234.50` — never parsed as a
  float, never rounded silently
- Search plus type and status filters; per-business unique names produce a friendly
  "that item already exists" message instead of a raw database error
- Built to feed the Phase 3 quote builder: `listCatalogueOptions()` already serves the pickers

**Jobs**

- Pipeline `LEAD → QUOTED → APPROVED → SCHEDULED → IN_PROGRESS → COMPLETED`, plus `CANCELLED` from
  anywhere and reopening (`CANCELLED → LEAD`, `COMPLETED → IN_PROGRESS`)
- The UI renders **only** the transitions that are legal from the current status, and the Server
  Action re-validates — a hand-crafted POST cannot force an illegal jump
- Job numbers (`JOB-0001`, …) from the row-locked `document_sequences` table, unique per business;
  `unique (business_id, job_number)` is the database backstop
- Customer picker with type-to-search autocomplete; when the site address is left blank it is copied
  from the customer so nothing is retyped on site
- Scheduling date, labour/notes fields, a job pipeline stepper, customer contact actions, a documents
  section ready for quotes/invoices, and a job history panel built from the audit trail

## 2. How it was built

| Layer | Files |
| --- | --- |
| Validation | `lib/validation/schemas.ts` — customer, catalogue item and job schemas; `withDefault` for optional selects; phone-or-email rule; money text rules |
| Domain rules | `lib/jobs.ts` — status list, legal transitions, labels, `applyJobStatus()` |
| Data access | `lib/repositories/{customers,catalogue,jobs,audit}.ts` — every function takes `(businessId, userId, …)` and runs inside `withContext()` |
| Server Actions | `lib/actions/{customers,catalogue,jobs}.ts` — `requireSession` → `safeParse` → repository → `revalidatePath` → `redirect` |
| UI | `app/app/{customers,catalogue,jobs}/**`, `components/forms/{customer,catalogue,job}-forms.tsx`, `components/app/{list-controls,job-status-actions}.tsx`, `components/ui/autocomplete.tsx` |
| Tests | `tests/integration/{customers,catalogue,jobs}.test.ts`, extended `tests/unit/{validation,jobs}.test.ts` |

Conventions that later phases inherit:

- **Every tenant query is scoped twice** — RLS in Postgres and an explicit `business_id` predicate —
  and a foreign id returns 404, not somebody else's data.
- **Writes return typed results** (`{ ok, id } | { ok: false, reason }`), so the UI can show a field
  error or a duplicate warning without exceptions for expected outcomes.
- **List state lives in the URL** (`?q=&status=&page=`), so screens are shareable, server-rendered
  and work without JavaScript (the search field is a real GET form).
- **Status changes go through one function** (`applyJobStatus`) with `SELECT … FOR UPDATE`, so
  concurrency cannot double-apply a transition — the same shape Phase 4/5 will use for invoice and
  payment status.
- **Nothing is deleted.** Archive flags plus audit events keep history intact for reports.

## 3. Verification

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | Clean (strict mode, `noUncheckedIndexedAccess`) |
| `npm run lint` | 0 errors, 0 warnings |
| `npm test` (Vitest) | **117 / 117 passing**, 11 files, real PostgreSQL |
| `npm run build` | Success — all Phase 2 routes compiled |
| Live smoke test | Signed-in requests to all 11 Phase 2 routes returned 200 with the expected records; foreign ids 404; no session redirects |

New automated coverage added in Phase 2 (40 tests):

- **Customers (9)** — create through the action, list and search, edit, duplicate warning plus
  deliberate confirm, archive → restore round trip, phone-or-email validation, cross-tenant read
  returns nothing, cross-tenant update refused, history populated on the detail screen
- **Catalogue (7)** — create with text price normalisation, per-business duplicate names, edit,
  archive/restore, filters, tenant isolation for list and update
- **Jobs (8)** — creation with inherited site address, per-business numbering (both businesses start
  at `JOB-0001`), every legal transition in order, illegal jump refused with
  `statusError=not_allowed` and nothing written, terminal states offer no further moves, client-site
  address inheritance, `completed_date` set on completion and cleared on reopen, cross-tenant status
  change lands on `/app/jobs?missing=1` and leaves the job untouched
- **Validation unit tests** — customer, catalogue item and job schemas, including the money rules
  (`0.005` rejected rather than rounded) and optional enum defaults

Manual acceptance (Phase 2 definition of done — run on a phone-sized viewport, keyboard only):

1. Sign in, open **Customers → New**, tab through every field, save — the customer appears in the list.
2. Open **Products & services → New**, add a labour item and a material item with a decimal price.
3. Open **Jobs → New**, type part of the customer's name to autocomplete, leave the site address
   blank (it is inherited), pick a scheduled date, save.
4. On the job detail screen advance `LEAD → QUOTED → APPROVED → SCHEDULED → IN_PROGRESS →
   COMPLETED`; every control is reachable by keyboard and every move is logged in the job history.
5. Confirm the illegal jump is impossible: a `COMPLETED` job offers no forward action.

## 4. Deliberate decisions

- **No new migration in Phase 2.** Phase 1 shipped the full schema, so customers, catalogue, jobs,
  sequences and audit events already existed with RLS — Phase 2 is application code on top.
- **The catalogue is the `products` table** with a `kind` discriminator, so the quote builder has one
  price source (a trade catalogue is one list of sellable things, even when one is labour).
- **Archive, never delete.** Tenant roles have no `DELETE` policy; contractors need history and
  Phase 6 reports would break if rows disappeared.
- **Status rules live in `lib/jobs.ts`, not in the page.** The stepper, the buttons and the action
  all read the same source of truth, so UI and enforcement cannot drift apart.
- **The customer picker is a real autocomplete** backed by server search, not a `<select>` of every
  customer, because a contractor's customer list grows without bound.

## 5. Not in this phase (unchanged scope)

Quotes, PDFs and the public acceptance page (Phase 3), invoices and quote conversion (Phase 4),
payments and receipts (Phase 5), the full report suite and dashboard completion (Phase 6), hardening
and Playwright end-to-end coverage (Phase 7). Those screens remain honest placeholders that name
what is missing.

**Next up — Phase 3:** the quote builder with dynamic line items, automatic totals, quote statuses,
branded A4 PDF generation and the public `/q/[token]` acceptance page that records who accepted,
when and from which IP — with the customer unable to edit any pricing.
