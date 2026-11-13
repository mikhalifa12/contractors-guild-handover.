# Contractors Guild — Phase 1 Report

**Scope completed:** Phase 1 — foundation, architecture, schema, design system, routes,
documentation, application shell, authentication and business onboarding.
**Status:** complete and verified. Phases 2–7 have intentionally **not** been started.

---

## 1. What was built

### 1.1 Public marketing website

| Route | Contents |
| --- | --- |
| `/` | Hero ("Electrical problems? We've got the power to fix it."), services overview, why choose us, CTA band, contact strip |
| `/services` | Fault finding, installations & repairs, maintenance, residential & small business, certified & reliable |
| `/about` | Who the Guild is, how we work, safety and trust commitments |
| `/contact` | Phone, WhatsApp, email, address, hours, service-area notes |
| `/request-quote` | Job-details form that hands the message to WhatsApp (click-to-chat). Nothing is stored, so no half-built backend is pretending to work |
| `/login`, `/register` | Marketing-consistent entry points into the workspace |

The visual language follows the brief: dark charcoal/near-black surfaces, burnt-orange accent,
white/light-grey text, bold uppercase display headings, shield-and-lightning identity, orange
divider/glow accents, clean cards, high contrast. The brand image is an SVG shield + bolt
(`components/brand/logo.tsx`), not a background image, so it stays crisp and themeable.

### 1.2 Workspace (`/app`)

- Shell: desktop sidebar, mobile bottom navigation + drawer, persistent **+ Create** action, user
  menu with sign-out
- Dashboard: live SQL aggregates (invoiced revenue, outstanding, overdue, unpaid invoices, quotes
  awaiting acceptance, customers, jobs), setup checklist driven by real rows, recent activity from
  `audit_events`
- Onboarding: guided business setup (identity, contact, banking, logo) after registration
- Settings: business profile, document defaults + numbering prefixes, banking details, account
  profile and password
- Placeholders for customers, jobs, quotes, invoices, payments and reports that state exactly which
  phase delivers them

### 1.3 Authentication and accounts

Registration (one transaction: user → business → OWNER membership → business settings → numbering
sequences → audit event), login, logout, forgot password, reset password (single-use, 60-minute,
hashed tokens), profile update, password change with other-session revocation, rate limiting, and
audit events for every authentication outcome. Session tokens are 256-bit CSPRNG values stored as
SHA-256 hashes in `httpOnly`, `SameSite=Lax`, `Secure`-in-production cookies.

### 1.4 Data layer

17 tables covering the full product roadmap (users, sessions, password reset tokens, businesses,
business users, business settings, document sequences, customers, products/services, jobs, quotes +
items, invoices + items, payments, receipts, audit events) with enums, constraints, indexes,
`updated_at` triggers, a generated `balance_due` column and a one-invoice-per-quote unique index.
Row level security is **forced** on every tenant table, with policies requiring the active business
plus an ACTIVE membership; authentication lookups go through `SECURITY DEFINER` helpers with pinned
`search_path`. The application connects as a `NOSUPERUSER NOBYPASSRLS` role.

### 1.5 Tooling, docs and tests

`npm run db:setup|start|stop|status|migrate|seed|reset` (real PostgreSQL 18 cluster from the
`embedded-postgres` binaries — no Docker), an obviously-fake demo seed script that refuses to touch
non-local databases, and the five requested documents: `README.md`, `ARCHITECTURE.md`,
`DATABASE.md`, `ROADMAP.md`, `SECURITY.md`.

### 1.6 Repository context

Phase 1 added the Contractors Guild application without replacing an earlier Contractors Guild
public site. This handover copy contains only the approved Contractors Guild application and its
project documentation; unrelated repository material is intentionally outside its scope.

---

## 2. Verification performed

| Check | Result |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit`) | **Clean** |
| `npm run lint` (ESLint) | **Clean** (0 errors, 0 warnings) |
| `npm test` (Vitest, real PostgreSQL + real RLS) | **77 passed / 77** across 7 files |
| `npm run build` (production) | **Succeeded** — 26 routes, middleware bundled |
| Production server smoke (`next start`) | Public pages 200; `/app` → `/login?next=%2Fapp`; authenticated dashboard renders seeded business data; security headers present |
| Dev server smoke | All public pages 200; every `/app` route 200 with a valid session; `/app/*` 307 to `/login` without one |
| Demo seed through the app role | **Succeeded** (3 customers, 5 catalogue items, 4 jobs) — exercises the same RLS policies as the app |

Test coverage highlights: registration transaction and duplicate email, sign-in success/failure/
unknown account, session revocation and expiry, one-time password reset with session invalidation,
protected-area redirects, 11 cross-tenant isolation tests (reads, inserts, updates, deletes,
missing membership, audit immutability, ignored forged `businessId`), business settings and banking
persistence, logo upload validation (PHP payload renamed `.png` rejected, SVG blocked), and open
redirect refusal.

**Not verified:** browser-level interaction (clicking through forms in a real browser). This is
Phase 7 work (Playwright end-to-end suite). Server-side behaviour is covered by the integration
suite, which executes the real Server Actions.

---

## 3. Decisions worth knowing

1. **PostgreSQL RLS is the isolation boundary**, not application filters. Application checks are
   defence in depth; the tests assert the database refuses cross-tenant work even when a query
   forgets.
2. **No ORM.** A small number of repository modules hold all SQL, which keeps the security-critical
   statements reviewable.
3. **Local development needs no Docker** — `db:setup` runs a real PostgreSQL 18 cluster from the
   `embedded-postgres` binaries, and the app connects through two roles (admin for migrations only).
4. **Documents are snapshots.** Quotes and invoices copy customer, address and job details at issue
   time, so editing a customer later cannot change an issued document.
5. **No fake functionality.** Sending (email/WhatsApp), PDFs, payments and reports are not built;
   the seams and the schema exist, and the screens say what is coming.
6. **Test count is 77, not "everything"** — the suite covers what Phase 1 built. Coverage grows with
   each phase.

---

## 4. Deliberately deferred to later phases

| Phase | Contents |
| --- | --- |
| 2 | Customers, products/services catalogue, jobs with the full status flow |
| 3 | Quote builder, quote statuses, public acceptance page with timestamp/actor/IP |
| 4 | One-click quote→invoice conversion, tax-invoice layout, partial payments, automatic receipts |
| 5 | Branded A4 PDF engine for quotes, invoices and receipts |
| 6 | Reports with date filters, dashboard completion, email driver, official WhatsApp Business API, read-only AI assistant tools |
| 7 | Playwright end-to-end journey test, HTTP-level attack suite, performance and accessibility passes, deployment hardening, multi-staff/multi-business |

Also deferred by design: expenses, recurring invoices, customer statements, online payments, and
anything requiring unofficial WhatsApp automation.

---

## 5. How to run it

```bash
npm install
cp .env.example .env
npm run db:setup      # real PostgreSQL cluster, roles, databases, migrations
npm run db:seed       # optional demo contractor (demo@contractorsguild.dev / guild-demo-password)
npm run dev           # http://localhost:3000
```

Then open `/register` to create a contractor account, or `/login` with the seeded demo account. The
dashboard starts empty for new accounts and fills in as Phases 2–5 begin writing documents.

---

## 6. Next step

Phase 2 — customers, catalogue and jobs — is ready to start on approval. It is the first phase that
turns the placeholders into working screens, and it establishes the list/detail/edit patterns the
rest of the workspace reuses.
