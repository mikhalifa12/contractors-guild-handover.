# Contractors Guild — Master Handover to Grok

**Purpose:** Transfer the independent Contractors Guild contractor-business management, quoting and invoicing platform to the new owner/development team. This is a **development handover**, **not** a production-readiness certification.

**Prepared from:** Owner-provided Codex audit and verification reports through Step 4J, with Step 4K proposed but **not executed**. Verify all claims against the delivered repository before acting.

## 1. Master instruction to Grok

You are the incoming lead engineering agent for **Contractors Guild**, a multi-tenant contractor-business management, quoting, invoicing and payment platform. Your responsibility is to take ownership of this standalone codebase, audit the handover, resolve outstanding defects, implement missing release controls, and continue the roadmap safely. **Do not assume the application is production-ready.**

Work exclusively within the dedicated Contractors Guild repository. Do **not** search for, import, connect to, copy from, or modify THNYK AI / ThinkAI, MORPHEUS, KHALIFA, or any other private project. Do not reintroduce their source, history, documentation, secrets or assets. The incoming repository must have **fresh Git history** and be **private** until its owner explicitly authorizes otherwise.

**Operating rules:**
1. Read `README.md`, `HANDOVER.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, and `PHASE-1-REPORT.md` through `PHASE-5-REPORT.md` first. Inspect actual source and tests before treating a report as verified.
2. Start with a repository inventory, secret/privacy scan, Git history/remote audit, dependency review and test-safety assessment. Never print credentials, reset tokens, real customer data or connection strings containing passwords.
3. Preserve existing product architecture, tenant isolation, financial integrity, transaction safety, audit logging, and authorization. Do not weaken security to make tests pass.
4. Propose a prioritized plan and ask the owner to approve changes affecting schema, payment rules, production infrastructure, permissions, external services, or public exposure.
5. Make small, reviewed changes with regression tests and clear progress reports. Separate confirmed defects from suspected defects and deployment requirements.
6. **Database test hazard:** The Vitest global setup initializes PostgreSQL and executes `TRUNCATE public.users, public.businesses RESTART IDENTITY CASCADE`; resets also occur between integration tests. Never run it against any existing, production, staging or shared database. Before each run, positively verify a fresh disposable cluster directory, unused loopback port, unique roles/databases, scrubbed inherited DB environment variables, and `TEST_STOP_DB=1`. Obtain explicit permission for any embedded PostgreSQL subprocesses. Do not use `db:reset`, `db:seed`, `launch`, `serve`, or `boot` casually.
7. Do not publish, deploy, add collaborators, open public tunnels, or push to a remote without explicit owner approval.
8. Provide a clear final status: completed, tested, blocked, security risks, and next actions.

## 2. Project baseline

- Platform: Next.js 15.5.26, React 19.1.9, TypeScript 5.9.3, PostgreSQL (embedded Windows development mode), Vitest.
- Last reported local environment: Windows x64, Node v22.21.0, npm 10.9.4.
- Product phases 1–5 have implementation and phase reports, but **full release verification has not passed**.
- Implemented areas documented in the handover include authentication, tenant/business setup, customers, quotes and public quote responses, quote-to-invoice conversion, invoices, payments, receipts and PDF workflows. Verify the actual completeness of each.
- Database migrations `0001`–`0009` exist. Migration `0009` includes payment receipt numbering and nullable `status_before` relevant to reversals.
- The standalone staging copy was exported from source commit `5c4ae75af1adb8abfc63803a346490c11b92e5b6` with **205/205 exact source-blob matches**, 76 unrelated files excluded, and no copied Git history. Subsequent documentation and code fixes changed staging files intentionally.
- The owner's Windows staging directory was `<original staging workspace>`. This is a historical local path, **not** a path Grok should expect on another machine.
- `HANDOVER.md` and a database-free Vitest config were added during preparation. Confirm the received copy contains all latest changes.

## 3. Work completed during preparation

**Documentation and separation**
- Standalone allowlisted export, no legacy Git history; no THNYK AI or KHALIFA source/documents included.
- README, roadmap, architecture, database, security and phase reports updated; `HANDOVER.md` added; legacy references removed; synthetic acceptance examples anonymized; `.gitignore` updated.
- TypeScript and ESLint passed on the last reported correction steps; dependency installation succeeded (`npm ci`, 416 packages).

**Corrections reported implemented in the staging copy**
- Removed password-reset URL/token logging; controlled development reset link retained through action state. Added regression test (not yet verified in full database-backed suite).
- Protected DRAFT/CANCELLED payment states; corrected reversal fallback to PARTIALLY_PAID for formerly paid invoices with outstanding balance; preserved valid unpaid states.
- Centralized registration rate-limiter reset in integration test database reset; production limits unchanged.
- Replaced expired ordinary quote fixtures with future-relative validity; explicit expired cases retained.
- Made persisted logo storage keys use POSIX separators; filesystem root containment preserved.
- Fixed `UNPAID` pseudo-filter to avoid exact-status predicate; preserved tenant scoping.
- Fixed quote-to-invoice INSERT mismatch (30 columns/placeholders/values), retaining transaction and authorization controls.
- Corrected cross-tenant invoice-send action to preserve non-revealing `not_found` response.
- Added/updated unit and integration regression tests and a database-free Vitest configuration.

**Reported verification**
- Step 4H: TypeScript passed; ESLint passed; 19 database-free tests passed.
- Step 4G: quotes integration suite 15 passed; invoices integration suite 8 passed, 4 failed (defects subsequently corrected in Step 4H).
- Step 4I: isolated invoices integration suite **10 passed, 2 failed**; later suites, full suite and production build were **not run**.
- Earlier Step 4D full suite (before subsequent fixes): **177 passed, 25 failed, 0 skipped (202 total)**. Do not represent this as current final results.
- Embedded PostgreSQL migrations `0001`–`0009` ran in isolated test clusters; clusters shut down afterward. Test-generated `data/` artifacts remain local and must not be committed.

## 4. Immediate unresolved defects — priority order

### P0: Cross-tenant reference integrity
Step 4J found that quote creation could accept a `customer_id` belonging to another business, because the new quote's `business_id` is RLS-protected but the referenced customer uses a simple foreign key without tenant-composite enforcement. Manual invoice creation may have the same problem. **This was identified, not fixed.**

Inspect all quote, invoice and job creation paths accepting `customerId` and optional `jobId`. Require tenant-scoped validation of each reference, ideally atomically in the same transaction, with indistinguishable missing/foreign errors. Add tests using real existing foreign IDs, not just random nonexistent UUIDs. Review whether database-level tenant-composite foreign keys are warranted; obtain approval before migrations. Avoid TOCTOU gaps and foreign-record information leakage.

### P1: Duplicate quote conversion result classification
Step 4I's sequential second conversion returned `not_convertible` rather than `already_converted`, although duplicate invoice creation was prevented. Step 4J traced this to the locked tenant-scoped quote query reading `status` but not `converted_invoice_id`, and checking non-ACCEPTED before already-converted state. **Not yet fixed.**

Within the existing `FOR UPDATE` tenant-scoped lookup, read `converted_invoice_id`; after confirming ownership, return `already_converted` for `CONVERTED` or non-null converted invoice before generic state rejection. Preserve `not_found` for foreign/missing IDs and unique-index/transaction protections. Test sequential and concurrent attempts, exactly one invoice.

### P1: Cross-tenant invoice integration fixture
Step 4I's cross-tenant test failed before reaching its intended assertion. Step 4J found registration of the second owner overwrote the shared mocked session cookie before creating/accepting the first owner's quote. The helper's owner argument does not switch the authenticated action session. The test also used a stale September 2026 quote validity date. **Not yet fixed.**

Create/accept first-owner quote while first-owner session is active; register second owner afterward; submit the **real** first-owner quote ID while second owner is active; assert non-revealing response, no invoice, unchanged first-owner quote. Use future-relative ordinary validity dates. Add forged-foreign customer/job reference tests.

### P1: Finish release verification
After fixes, run targeted invoice, quote, authentication, payment and business-profile integration tests, then full Vitest suite, typecheck, lint, dependency/security audit and telemetry-disabled production build. Use a **new** disposable database cluster and fresh port; prior test directories must not be reused as fresh. Perform a manual smoke test of registration, customer creation, quotes, public responses, conversion, invoices, payments, reversals, receipts, PDF generation and tenant isolation.

## 5. Production and operational gaps

These are **outstanding requirements**, not claims of implemented controls:
- Secure production password-reset email/delivery workflow; never log bearer tokens.
- Trusted reverse-proxy boundary for `x-forwarded-for`; client-supplied headers must not bypass rate limiting/auditing.
- Shared or edge rate limiting for multiple instances; in-memory limiter is per-process.
- Review historical Windows backslash storage keys before any cross-platform/object-storage migration.
- Review dependency vulnerabilities and unsupported ESLint 9.39.5 maintenance status; don't upgrade blindly during handover.
- Private repository CI, branch protection, secret scanning and least-privilege collaborator access.
- Production hosting/TLS, security headers, monitoring, logging hygiene, backup/restore evidence, object storage, data protection/POPIA review, independent security assessment.
- Review synthetic-looking test/customer fixtures and project-generated icon provenance before publication.

## 6. Recommended first session with Grok

1. Confirm that the delivered repository is **only** Contractors Guild, has no old history, contains `HANDOVER.md`, and has no local `.env`, `data/`, `.next/`, `node_modules/`, database dumps, credentials or real customer data staged for commit.
2. Read the documentation and inspect `git status`, tracked-file inventory, Git remotes and current source state. If the repository is not yet initialized, propose a new private repo with fresh initial commit; ask the owner before creating or pushing it.
3. Give the owner a concise gap analysis with P0/P1/P2 priorities, starting with tenant-reference integrity and the two Step 4J invoice failures.
4. Implement approved minimal fixes and regression tests; preserve tenant and financial security.
5. Execute isolated tests with explicit permission; document test counts and failures. Then typecheck, lint and build.
6. Establish safe CI and repository access; only after owner approval invite the brother's GitHub account as a collaborator. Never copy original private-project history.
7. Continue the documented `ROADMAP.md` after stabilizing the baseline; ask before changing product scope.

## 7. Handover acceptance criteria

For **development handover**: the brother has access to a clean **private** Contractors Guild-only repository, this master handover and project documentation, a verified list of unresolved defects, and a clear next-action plan. Production readiness is **not** required for the transfer, but unresolved risks must be explicitly disclosed.

For **production release** (later): critical tenant-integrity issues resolved, automated tests and build pass, secrets and dependencies audited, backup/restore tested, infrastructure controls deployed, and owner approval obtained.

---

**Owner-facing note:** The last requested Step 4K was only a proposed correction prompt. There is no reported implementation or test result for it. Do not assume it was performed.
