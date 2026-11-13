# Contractors Guild — Handover Guide

This staging copy is a clean Contractors Guild export prepared from source commit
`5c4ae75af1adb8abfc63803a346490c11b92e5b6`. It contains no source-repository Git history and must
remain separate from unrelated systems and their credentials, documents and code.

The owner should confirm the legal owner, incoming maintainer accounts, licence position and private
repository access before publication. This document is an operational handover aid, not evidence of
copyright assignment or production certification.

## What is implemented

Phases 1–5 are implemented:

- authentication, sessions, business onboarding, settings and tenant-isolated PostgreSQL access
- customers, catalogue items and jobs
- quote building, public quote review/acceptance and quote PDFs
- manual invoices, accepted-quote conversion, invoice lifecycle and invoice PDFs
- partial/final payments, reversals, receipts and receipt PDFs

See [README.md](README.md) for setup and feature details, [ARCHITECTURE.md](ARCHITECTURE.md) for the
implemented request and document workflows, [DATABASE.md](DATABASE.md) for migrations 0001–0009,
[SECURITY.md](SECURITY.md) for controls and production gaps, and [ROADMAP.md](ROADMAP.md) for planned
Phases 6–7.

## Verification status

The Phase 3 report preserves evidence of 160 passing database-backed tests plus typecheck, lint,
build and live checks at that point. The Phase 4 and Phase 5 reports preserve historical typecheck,
lint, build and targeted smoke-check results, but their full PostgreSQL-backed suites were not run
in the recorded environment. No CI workflow or CI result is included in this export.

Treat the current release state as **implementation complete through Phase 5, release verification
pending**. Do not claim that the current full suite passes until the release gate below succeeds on
the incoming team's clean environment.

## Local setup

Requirements:

- Node.js 20.11 or newer (use a supported LTS release)
- npm and sufficient disk/memory for Next.js plus PostgreSQL
- Windows x64 for the optional embedded PostgreSQL package, or an externally managed PostgreSQL 14+
  database on another platform

Initial development setup:

```bash
npm ci
cp .env.example .env
npm run db:setup
npm run db:seed
npm run dev
```

On PowerShell, copy the template with `Copy-Item .env.example .env`. Replace only local development
values in `.env`; never commit that file. The seed is optional and is for disposable local data.
The database reset command is destructive and must never target shared or production data.

## Required release gate

Use a dedicated disposable test database because the test setup applies migrations and truncates
tenant tables. Never point `TEST_DATABASE_URL` or the test helpers at development, staging or
production data.

1. Install exactly from `package-lock.json` with `npm ci`.
2. Configure a disposable PostgreSQL test database and apply migrations 0001–0009.
3. Run `npm run typecheck`.
4. Run `npm run lint`.
5. Run `npm test` and retain the complete result.
6. Run `npm run build`.
7. Smoke-test authentication, tenant isolation, quote acceptance, quote conversion, manual invoice
   creation, invoice PDF, partial/final payment, reversal and receipt PDF.
8. Check desktop and phone-width layouts and confirm signed-out users cannot access workspace routes.
9. Review dependency, licence and vulnerability reports before creating a release.

## Deployment and security requirements

Before using real customer or financial data:

- use a private repository with least-privilege access, protected release branches, required review
  and CI for typecheck, lint, test and build
- provision a managed PostgreSQL service with TLS, a dedicated non-superuser runtime role, encrypted
  backups and a tested restore procedure
- keep admin and migration credentials outside application runtime configuration; rotate every
  development credential before deployment
- use private object storage for uploads rather than local disk
- configure the production base URL, public contact values, secure cookies, CSP/HSTS, monitoring,
  rate limiting, audit retention and secret scanning
- put authentication endpoints behind a shared-store or edge rate limiter for multi-instance
  deployments; the built-in limiter is process-local and does not provide distributed protection
- configure a trusted reverse proxy to remove client-supplied forwarded-IP headers and set the
  authoritative client address before relying on IP-based rate limits or audit records
- arrange an independent security review and confirm POPIA retention/erasure procedures
- add a private production email delivery/reset workflow; reset tokens are not logged and the
  development-only reset-link response is not a production operating process

Public quote URLs are bearer credentials. Do not place them in public tickets, logs or chat. Public
invoice and customer-facing receipt delivery are not implemented, even though database tokens exist.
Online payments are also not implemented; current payments are staff-recorded transactions.

## Outstanding work

Phase 6 remains planned: reports/CSV export, dashboard completion, email delivery, official WhatsApp
Business API integration and any carefully scoped assistant features. Phase 7 remains planned:
browser end-to-end tests, attack/performance/accessibility testing, deployment hardening, multi-staff
invitations and business switching. See [ROADMAP.md](ROADMAP.md); placeholders and seams must not be
presented as completed features.

Operational gaps also include a production runbook, incident contacts, service ownership, backup
retention, restore evidence, monitoring thresholds and rollback procedures. Before moving an
existing Windows deployment to Linux or object storage, inventory historical logo storage keys for
backslash separators and plan an explicit database-and-file migration; no automatic migration is
included. Before real payments are recorded, verify the payment/reversal invariant tests and the
full database-backed suite against a disposable database.

## Recommended sequence for the incoming development team

1. Create a new private Contractors Guild repository from this staging copy with fresh history.
2. Assign the owner and incoming maintainers, require MFA, record recovery administrators, protect
   the release branch and enable secret scanning without importing unrelated repository history.
3. Reproduce the release gate on a clean host and fix failures before feature development.
4. Establish CI, dependency updates, review rules and release evidence.
5. Write and exercise the deployment, backup/restore, incident and rollback runbooks in a non-
   production environment.
6. Complete the production security items in [SECURITY.md](SECURITY.md).
7. Implement Phase 6 in small reviewed changes, followed by Phase 7 hardening before launch.

For xAI Grok or other development agents: inspect the documentation and migrations before editing;
keep SQL in repositories; preserve session-derived tenant context and RLS; append migrations rather
than rewriting applied files; never expose secrets or public-document tokens; never run tests or
reset commands against non-disposable data; and update documentation and verification evidence in
the same reviewed change as behaviour.

## Repository publication checklist

- Confirm ownership/licensing of the five supplied icons and all third-party dependencies.
- Confirm this export contains only approved Contractors Guild files and no `.git`, `.env`, database,
  upload, dependency, build, editor or runtime artefacts.
- Create the private repository under the owner's chosen GitHub organisation/account.
- Add the owner's brother and any development agents with the minimum necessary role.
- Keep at least two human recovery administrators; do not make an automation account the sole owner.
- Add branch protection, required reviews/status checks, secret scanning and dependency alerts.
- Make the first commit only after the clean inventory, privacy scan and release-gate plan are
  approved by the owner.
