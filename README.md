# Contractors Guild

**Powered by contractors. Built on trust.**

A contractor business-management platform: a public electrical-services website plus a secure
workspace for customers, jobs, quotes, invoices, payments and receipts.

This repository contains the Contractors Guild implementation through **Phase 5**: the application
foundation, authentication and business onboarding; customers, catalogue and jobs; quotes and
public quote acceptance; invoices and quote conversion; and payments, reversals and receipts.
Reporting, outbound communications, production hardening and multi-staff workflows remain planned.

---

## Status: what works today

| Area | State |
| --- | --- |
| Public marketing website (home, services, about, contact, request a quote) | **Built** |
| Contractors Guild design system (dark industrial + burnt orange, mobile-first) | **Built** |
| Registration, login, logout, password reset, profile & password change | **Built** |
| Business profile, logo upload, document numbering settings, banking details | **Built** |
| Dashboard shell with live aggregates (revenue, outstanding, overdue, quotes awaiting) | **Built** |
| Database schema for the full product (17 tables) + row level security | **Built** |
| Customers (create, edit, archive, search, history) | **Built** |
| Products & services catalogue (pricing, units, VAT, archive) | **Built** |
| Jobs (job numbers, scheduling, full status pipeline, history) | **Built** |
| Quotes (builder, dynamic lines, automatic totals, statuses, duplicate, history) | **Built** |
| Quote PDF (branded A4, logo, multi-page, print-safe) | **Built** |
| Customer quote page `/q/<token>` (view, accept or decline, no sign-in) | **Built** |
| Invoices (builder, conversion, statuses, tax-invoice PDF) | **Built** |
| Payments, receipts, receipt PDF, automatic `PARTIALLY_PAID`/`PAID` transitions | **Built** |
| Reports | **Placeholder** — see [ROADMAP.md](ROADMAP.md) |
| Email sending, official WhatsApp Business API, AI assistant | **Not built yet** (Phase 6) |
| Online payments, expenses, recurring invoices, customer statements, multi-staff | **Deferred** — see [ROADMAP.md](ROADMAP.md) |

Placeholder screens say exactly what is missing instead of showing fake data or dead buttons.

---

## Quick start

The package manifest requires **Node.js 20.11+** and npm. For a new handover environment, use a
currently supported Node.js LTS release that satisfies that constraint and record the exact version.

The bundled embedded-PostgreSQL dependency is Windows x64. On another platform, install the matching
`@embedded-postgres/<os>-<arch>` package or provide PostgreSQL 14+ through `DATABASE_URL` and
`DATABASE_ADMIN_URL`. Docker is not required when a supported embedded package is available.

```bash
npm ci                      # install the locked dependencies
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
npm run db:setup            # start local PostgreSQL, create roles/DB, run migrations
npm run db:seed             # optional: demo contractor with example customers, jobs, catalogue
npm run dev                 # http://localhost:3000
```

`npm run db:seed` creates one obviously-fake demo contractor
(`demo@contractorsguild.dev` / `guild-demo-password`, overridable in `.env`) with three customers,
five catalogue items, four jobs, three quotes (one awaiting the customer, one accepted, one
draft), a converted invoice carrying a part payment (partially paid) and a second invoice paid in
full — every screen has real rows in it. The seed prints the customer-facing link of each quote
that has been sent — open it in a browser to accept a quote the way a customer would.

Run `npm run db:seed -- --session` to also print a ready-to-use session cookie for local previews,
and `npm run db:seed -- --force` to rebuild the demo tenant from scratch. The script refuses to run
against a non-local database.

`npm run db:setup` starts a real PostgreSQL 18 cluster using the binaries shipped by the
`embedded-postgres` dev dependency, writes its data directory to `data/pg` (git ignored), creates
two roles, creates the development and test databases and applies every migration.

The app connects with the **non-superuser** role `cg_app` so that PostgreSQL row level security is
actually enforced (see [SECURITY.md](SECURITY.md)). `cg_admin` is used only by migration tooling.

### Environment

Copy `.env.example` to `.env` and set at least:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Application connection string (**non-superuser** role) |
| `DATABASE_ADMIN_URL` | Migration/owner connection string (scripts only) |
| `DEV_DB_SUPERUSER_PASSWORD`, `APP_DB_PASSWORD` | Passwords for the local cluster created by `db:setup` |
| `PUBLIC_APP_URL` | Base URL used to build customer-facing links |
| `PUBLIC_CONTACT_*` | Phone, WhatsApp, email, address and hours shown on the public site |
| `PASSWORD_HASH_COST` | scrypt work factor (16384 local default, raise for production) |

`.env` is git ignored. No credentials, API keys or banking details belong in source code — banking
details are entered per business inside the app and stored in the database.

**Before going live, replace the `PUBLIC_CONTACT_*` placeholders** (`+27 00 000 0000`,
`hello@example.com`, …) with the real business details.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on `0.0.0.0:3000` |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Vitest: unit + database integration suites (real PostgreSQL) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (Next.js core-web-vitals + TypeScript rules) |
| `npm run db:setup` | First-time database setup |
| `npm run db:start` / `db:stop` / `db:status` | Local cluster lifecycle |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Insert obviously-fake demo data (local databases only) |
| `npm run db:reset` | **Destructive**: recreate the development database |

---

## Implemented functionality (Phases 1–5)

**Public website** — Hero ("We've got the power" / "Powered by contractors. Built on trust."), services
(fault finding, installations & repairs, maintenance, residential & small business, certified &
reliable), why-choose-us (safety first, on time every time, built on trust, local/reliable/
professional), contact (phone, WhatsApp, email, address) and a request-a-quote page that hands
off to WhatsApp with the job details prefilled.

**Authentication** — Email + password with memory-hard scrypt hashing, hashed session tokens in
`httpOnly` cookies, password reset with single-use expiring tokens, profile and password changes
that sign out other devices, rate limiting on sign-in/registration/reset, and audit events for
every authentication outcome.

**Business onboarding** — Registration creates the user, business, owner membership, default
document settings and numbering sequences in **one transaction**. A guided setup screen collects
identity, address, banking details and a logo.

**Settings** — Business profile, logo (PNG/JPEG/WebP, validated by file content), document
defaults and numbering prefixes, banking details, and account/password management.

**Dashboard** — Live SQL aggregates for total revenue, outstanding, overdue, unpaid invoice count,
quotes awaiting acceptance, customer/job counts, plus a setup checklist and recent-activity feed
that populate as soon as Phases 2–5 start writing data.

**Customers (Phase 2)** — list with search across name/phone/email, active/archived/all filters and
pagination; create and edit with billing plus separate job-site addresses; duplicate detection that
warns but does not block; per-customer history of jobs, quotes, invoices and payments; archive and
restore instead of delete; quick call, WhatsApp and email actions; and an activity trail from the
audit log.

**Products & services catalogue (Phase 2)** — one catalogue with products and services, unit
pricing entered as text and normalised to two decimals, VAT rates, cost price, categories, SKUs,
archive/restore, filters and search. Names are unique per business.

**Jobs (Phase 2)** — job numbers allocated from the transactional sequence (`JOB-0001`, restarting
per business), customer link with autocomplete, site address inherited from the customer when left
blank, scheduling date, notes, and the full pipeline `LEAD → QUOTED → APPROVED → SCHEDULED →
IN_PROGRESS → COMPLETED` plus `CANCELLED` and reopening. Illegal jumps are refused in the action and
recorded in the job history.

**Quotes (Phase 3)** — builder with dynamic line items, catalogue lookup, per-line discount and VAT,
and automatic totals recomputed **on the server** (browser-supplied totals are ignored); statuses
`DRAFT → SENT → VIEWED → ACCEPTED / DECLINED / EXPIRED`; Phase 4 adds the implemented `CONVERTED`
transition when an accepted quote becomes an invoice. A
quote that has been sent is immutable — revise by duplicating it into a new draft; transactional
numbering (`QUOTE-0001`, per business); a branded A4 PDF (business logo, itemised table, totals,
terms, page numbers, multi-page); and the public `/q/<token>` page where a customer reads the quote
and accepts or declines it, with the name, timestamp and IP address recorded and an audit entry on
the business's timeline. The customer can never edit pricing: the public surface exposes no price
inputs and all totals come from stored rows. Marking a quote sent moves its job to `QUOTED`.

**Invoices (Phase 4)** — manual invoice builder plus one-click conversion of an accepted quote;
server-calculated totals; draft-only editing; sent, overdue and cancelled states; generated
`balance_due`; transactional invoice numbering; and a branded tax-invoice PDF. Conversion copies
the quote snapshot and line totals in one transaction, marks the quote `CONVERTED`, and refuses a
second conversion.

**Payments and receipts (Phase 5)** — partial and final payments, multiple payments per invoice,
overpayment refusal, automatic `PARTIALLY_PAID`/`PAID` transitions, per-business receipt numbering,
receipt PDFs, and non-destructive reversal. Payment, receipt, invoice balance/status and audit event
changes are written together; reversal retains the financial records and restores the remembered
invoice state.

**Workspace protection** — `middleware.ts` sends signed-out visitors away from `/app` before any
server work happens, and the layout's `requireSession()` performs the authoritative check (session
existence, expiry, revocation, active user, ACTIVE membership) on every request. Post-login
redirects only honour same-origin `/app` targets.

**Foundation** — Full relational schema for the whole product, row level security on every tenant
table, transactional document numbering, money/tax engine with documented rounding rules, storage
abstraction for logos, demo seed script (customers, catalogue items and jobs included), and
architecture notes for AI, WhatsApp and payments integration.

## Testing

```bash
npm test
```

The repository contains unit and PostgreSQL integration suites for Phases 1–5. Historical Phase 3
evidence records 160 passing tests at that point. Phase 4 and 5 added invoice and payment suites,
but their database-backed runs were not completed on the development machine and no repository CI
workflow exists in this export. **Do not treat the current suite as passing until the handover release
gate is run in a clean environment.**

- **Unit** — password hashing and policy, token generation/hashing, money and tax arithmetic
  (blocking discount→tax→total rounding drift), validation schemas for auth, business, customers,
  catalogue items and jobs (including the money-text and phone-or-email rules), document numbering
  format, the job status pipeline (which transitions are legal, and which are not), the quote
  status machine (including expiry rules and who may answer), quote and invoice line schemas,
  invoice/payment status rules, reversal rules, and quote/invoice/receipt document models.
- **Integration (real PostgreSQL, real RLS)** — registration transaction, duplicate email,
  sign-in success/failure/unknown account, session revocation and expiry, one-time password reset
  with session invalidation, protected-area redirects, cross-tenant read/write/update/delete
  attempts, membership requirements, audit-trail immutability, business settings persistence,
  "business id in the form is ignored" attack, logo upload validation (including a PHP script
  renamed to `.png` and a blocked SVG), post-login redirect validation (a same-origin `/app` target
  is honoured, an external one is refused), customer CRUD/search/duplicate/archive behaviour,
  catalogue pricing and duplicate-name rules, the job pipeline (numbering per business, address
  inheritance, every legal transition, refused illegal jumps, cross-tenant reads and writes), and
  the full quote lifecycle: server-side totals, tampered line payloads, per-business numbering,
  catalogue price snapshots, draft-only edits, public link creation, customer acceptance with
  recorded name/IP and audit trail, second responses refused, expired quotes refused, offline
  decisions recording who did it, job status follow-through, invoice creation/conversion/editing,
  payment and reversal flows, receipt creation, cross-tenant isolation and PDF renderers.

The integration suite talks to PostgreSQL through the non-superuser role, so row level security is
exercised rather than simulated. Its global setup applies migrations and truncates tenant tables;
run it only against a positively identified disposable test database. See [HANDOVER.md](HANDOVER.md)
for the required clean-environment verification sequence.

## Project layout

```text
app/                    Next.js App Router
  (marketing)/          Public website (home, services, about, contact, request a quote)
  (auth)/               Login, register, forgot/reset password
  app/                  Secure contractor area (dashboard, customers, catalogue, jobs, quotes,
                        invoices, payments, reports placeholder, settings)
    customers|catalogue|jobs/   Phase 2 modules (list, create, detail, edit)
    quotes/             Phase 3 module (list, builder, detail, edit, PDF route)
    invoices/           Phase 4 builder, conversion, status workflow and PDF
    payments/           Phase 5 payment, reversal, receipt detail and PDF
    reports/            Honest Phase 6 placeholder
  q/[token]/            Public quote page (view, accept, decline) + its PDF and logo routes
  api/businesses/[id]/logo/  Authenticated logo delivery
components/             Design system, marketing sections, app shell, forms
lib/
  actions/              Server Actions (auth, business, customers, catalogue, jobs, quotes,
                        invoices, payments, public quote responses) + form state
  auth/                 Password hashing, tokens, sessions, current user
  db/                   Connection pool, tenant context, type parsers
  repositories/         All SQL, one module per aggregate (users, businesses, dashboard,
                        customers, catalogue, jobs, quotes, invoices, payments, public quotes,
                        dashboard, audit)
  pdf/                  A4 PDF toolkit and quote, invoice and receipt renderers (pdf-lib)
  validation/           Zod schemas
  money.ts, numbering.ts, format.ts, jobs.ts (pipeline rules), quotes.ts (quote status machine),
  quote-draft.ts (line drafts shared by the builder and the edit page), storage/, security/
db/migrations/          Versioned SQL schema + RLS + auth helpers
middleware.ts           Edge pre-filter for /app (the real gate is requireSession)
scripts/                Database CLI, local PostgreSQL lifecycle, demo seed
tests/                  Vitest unit + integration suites
```

## Documentation

| Document | Contents |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack decisions, layering, request lifecycle, extensibility |
| [DATABASE.md](DATABASE.md) | Schema, relationships, indexes, RLS model, migrations |
| [ROADMAP.md](ROADMAP.md) | Phase-by-phase plan and status |
| [PHASE-1-REPORT.md](PHASE-1-REPORT.md) | What Phase 1 delivered |
| [SECURITY.md](SECURITY.md) | Threat model, controls, known limitations |
| [PHASE-2-REPORT.md](PHASE-2-REPORT.md) | What Phase 2 delivered, how it was verified, decisions |
| [PHASE-3-REPORT.md](PHASE-3-REPORT.md) | What Phase 3 delivered, how it was verified, decisions |
| [PHASE-4-REPORT.md](PHASE-4-REPORT.md) | Invoice and quote-conversion implementation report |
| [PHASE-5-REPORT.md](PHASE-5-REPORT.md) | Payment, reversal and receipt implementation report |
| [HANDOVER.md](HANDOVER.md) | Ownership, setup, verification, deployment and incoming-agent guidance |

## Deployment outline

1. Provision PostgreSQL (Supabase, RDS, Neon…) and set `DATABASE_URL` to a **non-superuser** role.
2. Set `DATABASE_ADMIN_URL` to a role with `SUPERUSER` or `BYPASSRLS` and run `npm run db:migrate`.
3. Implement or select durable private upload storage. The current code accepts only the local
   driver and writes to `STORAGE_LOCAL_DIR`; an object-storage driver is an extension point, not an
   implemented production feature.
4. Set `DATABASE_SSL=require` (and stricter for managed providers), `NODE_ENV=production`,
   a strong `PASSWORD_HASH_COST`, and the real `PUBLIC_*` values.
5. Add backups with a tested restore, monitoring, log retention, TLS/security headers, shared rate
   limiting and an operator procedure for password resets.
6. Run the complete release gate, then `npm run build && npm start` behind a production process
   manager and TLS reverse proxy or managed platform.

This is an outline, not a production runbook. Production launch remains Phase 7 work.

## Known limitations

- No email provider is connected, so password reset links are printed to the server log and
  returned in the UI **in development only**; production shows a neutral message.
- Rate limiting is in-process (single instance). Use an edge/WAF limiter for multi-instance
  deployments.
- Uploaded logos are validated by magic bytes, not decoded as images (no native image library).
- The brand artwork (poster) and the reference invoice were not supplied with the build request,
  so the visual identity and logo are faithful recreations from the written brand language;
  replacing the logo means editing `components/brand/logo.tsx`.
- Browser-level end-to-end tests, accessibility testing, realistic-volume performance testing and
  a current clean-environment release run are outstanding Phase 7 work.
- Reports and CSV export, email delivery, the official WhatsApp Business API, AI assistance,
  customer-facing invoice/receipt links, online payments and multi-staff workflows are not built.
- Local file storage is not suitable for horizontally scaled or ephemeral production hosting.
- A quote whose validity date has passed is **reported** as expired everywhere it is displayed; the
  `EXPIRED` status is written when someone acts on the quote (or from the quote's Actions panel).
  Nothing about it is invented: the stored status and the validity date are both visible.
