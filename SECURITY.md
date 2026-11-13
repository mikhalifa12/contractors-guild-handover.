# Contractors Guild — Security

How the platform is designed to protect contractor data, which controls are implemented, what has
historical verification evidence, and what remains required before production.

Controls described below are implemented in the exported source unless explicitly marked planned.
They are not a production certification: Phase 4/5 database-backed tests, independent security
review and deployment hardening remain outstanding.

Security model in one sentence: **every request is authenticated to a user, every database statement
runs with that user's tenant context, and PostgreSQL row level security — not application
politeness — decides which rows exist for that request.**

---

## 1. What we are protecting

| Asset | Why it matters |
| --- | --- |
| Customer lists, addresses, phone numbers, emails | Personal information (POPIA), business-critical relationships |
| Quotes, invoices, payments, receipts | Financial records; tampering or disclosure is a legal and commercial risk |
| Business banking details (`business_settings`) | Payment redirect fraud is the highest-impact attack on an invoicing platform |
| Login credentials and sessions | Account takeover exposes everything above |
| Public quote links | Anyone with the link can read one quote — tokens must be unguessable. Invoice and receipt tokens exist in storage, but public delivery routes are not implemented. |

---

## 2. Threats and controls

| Threat | Control |
| --- | --- |
| **Cross-tenant data access** (the big one) | `FORCE ROW LEVEL SECURITY` on every tenant table; policies require `business_id = app.current_business_id()` **and** an ACTIVE membership. The application role is `NOSUPERUSER NOBYPASSRLS`. The historical suite includes 11 dedicated isolation tests. |
| **Privilege escalation through the app role** | The runtime role cannot create roles, databases, or bypass RLS. The admin role is used only by CLI tooling and never appears in application code. |
| **Forged tenant id in a form** | Server Actions never read a business id from input; the tenant comes from the session. A test submits another business's id and asserts it is ignored. |
| **Credential stuffing / brute force** | scrypt password hashing with a per-password salt; fixed-window rate limits on login (by IP+email), registration, and password reset; failed logins recorded in `audit_events`. Forwarded client IP headers are trustworthy only when a configured reverse proxy strips incoming values and supplies its own. |
| **User enumeration** | Sign-in, sign-out and password-reset responses are identical for existing and unknown accounts; a dummy scrypt verification runs when the account is unknown so response time does not leak existence. |
| **Session hijacking** | 256-bit random tokens, only the SHA-256 hash stored, `httpOnly` + `SameSite=Lax` + `Secure` (in production) cookies, 30-day expiry, revocation on sign-out and on password change, and re-validation of the user's `is_active` flag and ACTIVE membership on every request. |
| **Password reset abuse** | Tokens are single-use, hashed at rest, expire after 60 minutes, and requesting a reset invalidates previous tokens. |
| **Session fixation / stale context** | Sessions are created server-side after authentication; the tenant context is set per transaction with `set_config(..., true)` so it cannot leak across pooled connections. |
| **SQL injection** | Every query is parameterised; identifiers in tooling SQL are quoted through `quoteIdent`/`quoteLiteral`. No string concatenation of user input anywhere. |
| **Malicious uploads** | Logos are size-limited, extension-whitelisted, and validated by **content** (PNG/JPEG/WebP magic bytes) — a PHP script renamed `.png` is rejected, and SVG (script-capable) is refused. Files are stored outside the web root and served only through an authorised route with `Cache-Control: private`. |
| **Stored XSS through documents** | React escapes rendered values by default; no `dangerouslySetInnerHTML` in the codebase. A Content-Security-Policy should still be added at the edge before launch (§5). |
| **Open redirect after sign-in** | The `next` parameter is validated by `safeAppRedirectPath()`: only same-origin `/app…` paths are honoured, everything else falls back to the dashboard. |
| **Clickjacking / MIME sniffing** | `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` disabling camera/mic/geolocation/payment, and `poweredByHeader: false`. |
| **Tampering with financial records** | Quotes/invoices/payments/receipts have no delete policy for the app role; the audit table is append-only; totals live in `NUMERIC(14,2)` with integer-cent arithmetic in the application; `balance_due` is a generated column. |
| **Bank-detail substitution** | Banking details are per business, editable only by that business's members through authenticated actions, and never accepted from a public (customer-facing) route. |
| **Enumeration of public documents** | Quote links carry a 192-bit CSPRNG token (`crypto.randomBytes(24)`, base64url). Lookups are by unique index through `SECURITY DEFINER` functions that return a fixed shape for one document only — no ids, no lists, no banking details — and the value is never written to logs or referrers (`Referrer-Policy: strict-origin-when-cross-origin`, `X-Robots-Tag: noindex` on the PDF). A token is a bearer credential: anyone holding the link can read that one quote. |
| **Price tampering by a customer** | The public quote page has no price inputs. Acceptance and decline post only `token`, `decision`, `name` and `reason`; every total shown is read from stored `quote_items` rows, and the database function only ever writes the acceptance/decline columns of that one quote. Line totals sent by the *contractor's* browser are likewise ignored — the server recomputes them from the submitted quantities and unit prices. |
| **Acceptance forgery / replay** | Only a quoted status of `SENT`/`VIEWED` inside its validity window can be answered, the first answer wins (a second attempt is refused with `not_open`), and each attempt is recorded with the submitted name, the request IP and the user agent in the audit trail. |
| **Secret leakage** | All configuration comes from environment variables, validated at startup; `.env` is git ignored; `.env.example` carries placeholders only. No secrets in source, no secrets in client bundles (`NEXT_PUBLIC_*` is used for nothing sensitive), and password-reset bearer tokens are not written to application logs. |
| **Unauthorised WhatsApp use** | No automation of personal WhatsApp accounts. Only official click-to-chat links today; the official Business API is the only future path (Phase 6). |

---

## 3. Authentication and session details

- **Passwords**: minimum 10 characters, maximum 200, hashed with scrypt (`N=16384, r=8, p=1`,
  16-byte salt, 64-byte key) and stored as `scrypt$N=…,r=…,p=…$salt$hash`. Cost is configurable and
  compared against the stored value, so raising it later upgrades users on next login.
- **Sessions**: opaque token in the `cg_session` cookie; the database stores only `sha256(token)`.
  `expires_at` is enforced in SQL, `revoked_at` supports sign-out, and `last_seen_at` (updated at
  most every five minutes) gives an activity trail without a write per request.
- **Session validation** (`app.auth_find_session`): joins the user, an ACTIVE membership, and the
  business in one security-definer call, returning the role and status the UI needs.
- **Authorisation**: `requireSession()` in the workspace layout redirects unauthenticated visitors;
  every mutating action re-derives the tenant from the session; role-based restrictions (OWNER /
  ADMIN / STAFF / VIEWER) are modelled in the schema and will be enforced per-action as staff
  invitations land in Phase 7.
- **Middleware** is a fast cookie-presence pre-filter only. It is not the security boundary; the
  server-side session check is.

---

## 4. Test coverage and verification status

The Phase 3 report records a historical run of **160 passing tests** against real PostgreSQL and
real RLS. Security-relevant coverage in that recorded suite included:

- registration provisions exactly one user/business/membership/settings/sequence set, and duplicate
  emails are rejected (case-insensitively)
- wrong password and unknown account return the same message; failures are audited and issue no
  session
- sign-out revokes only the signed-in session; expired/forged/revoked sessions are rejected and
  redirect to `/login`
- password reset links are single-use and expire; requesting a reset invalidates earlier tokens;
  password change revokes other sessions
- cross-tenant reads return no rows; cross-tenant inserts raise an RLS violation; cross-tenant
  updates and deletes affect no rows; a missing membership blocks access
- `audit_events` cannot be updated or deleted by the app role
- a `businessId` supplied in a form cannot redirect a write into another business
- logo upload rejects a PHP payload renamed `.png`, rejects SVG, enforces the size limit, and stores
  files under `logos/{businessId}/…`
- open-redirect attempts through the `next` parameter fall back to `/app`
- customers, catalogue items and jobs cannot be read, updated, archived or advanced by another
  business, and job numbers restart per business so a sequence can never leak activity across
  tenants

Phase 4 and Phase 5 add invoice, payment, receipt, PDF and tenant-isolation tests. Those test files
are present, but their database-backed execution was not completed in the recorded development
environment. This export contains no CI workflow or preserved CI result, so the current full-suite
status is **unverified** until the incoming team runs the release gate against a disposable database.

Phase 7 adds HTTP-level attack tests (URL/id tampering, token guessing) and a browser suite over the
full document journey.

---

## 5. Before production — checklist

- [ ] Set `NODE_ENV=production`, `DATABASE_SSL=require` (or `verify-full` for managed providers)
- [ ] Raise `PASSWORD_HASH_COST` to 32768+ on production hardware
- [ ] Replace all `PUBLIC_CONTACT_*` placeholders with real business details
- [ ] Use a dedicated non-superuser database role with a strong password; rotate the local dev
      credentials; never reuse `cg_admin` for the app
- [ ] Add a Content-Security-Policy (and HSTS) at the edge/CDN; keep framing blocked
- [ ] Put a shared-store or edge rate limiter in front of `/login`, `/register` and
      `/forgot-password` (the built-in limiter is per instance)
- [ ] Configure a trusted reverse proxy to discard client-supplied `X-Forwarded-For` values and set
      the authoritative client address before enabling IP-based audit or rate-limit decisions
- [ ] Add private production password-reset delivery; never use application logs to deliver tokens
- [ ] Move uploads to object storage with private access and signed links
- [ ] Enable database backups with a tested restore, plus point-in-time recovery if available
- [ ] Turn on error monitoring and log retention; make sure no request bodies are logged
- [ ] Review `audit_events` retention and access (it is business-scoped, append-only)
- [ ] Add 2FA/TOTP and email verification when the email provider lands (Phase 6)
- [ ] Run `npm run typecheck`, `npm run lint`, the full `npm test` suite against a disposable
      PostgreSQL database, `npm run build`, and authenticated route/PDF smoke checks
- [ ] Add private-repository CI, protected release branches, dependency scanning and secret scanning
- [ ] Complete an independent application-security review before exposing customer or financial data

---

## 6. Known limitations

1. **Rate limiting is in-process.** It protects a single instance; it is not a defence against a
   distributed attack. Use edge/WAF or a shared store for multi-instance deployments.
2. **No email provider yet.** Password reset links are returned in the UI **in development only**
   and are never printed to application logs; production returns a neutral message and no link.
   Production password-reset delivery remains unavailable until a private delivery provider is
   implemented in Phase 6.
3. **No 2FA and no email verification** yet.
4. **No CSP/HSTS** in `next.config.ts` — these belong at the edge (see checklist).
5. **Uploads are validated by content, not decoded** (no native image library), so a valid-but-large
   or malformed image could pass. Server deployments should also cap uploads at the proxy.
6. **Personal data retention/erasure tooling is not built.** POPIA erasure requests are currently
   handled manually with the append-only audit trail as the record of what was removed.
7. **A single session acts in a single business** (the earliest ACTIVE membership). Multi-business
   switching arrives in Phase 7; the isolation model does not change.
8. **Demonstration seed data** (`npm run db:seed`) is obviously fake and refuses to run against a
   non-local database. It must never be run against production.
9. **A customer quote link is a bearer credential.** Anyone with the URL can read that one quote and
   answer it. Links can be re-issued (duplicate the quote, or mark it declined) and every open and
   answer is recorded with an IP and user agent, but there is no per-customer login on the public
   page — by design, because forcing a customer to create an account before accepting a quote loses
   work. Phase 6 adds delivery tracking when quotes start going out by email or WhatsApp.
10. **Current release evidence is incomplete.** Phase 4/5 database-backed suites are authored but
    not recorded as run, no repository CI workflow is included, and no independent penetration test
    or dependency audit is documented.
11. **Local file storage is development-oriented.** Production needs private object storage,
    controlled retention and tested backup/restore procedures. New logical storage keys use `/`
    separators on every platform. A database created by an older Windows build may contain `\`
    separators and must be inventoried and migrated deliberately before moving its files or records
    to Linux or object storage; this release performs no automatic key migration.
12. **Forwarded IP addresses require a trusted proxy.** The application uses the first
    `X-Forwarded-For` value when present. A deployment that accepts that header directly from the
    internet permits spoofed audit addresses and weakens IP-based rate limiting.
13. **Financial status integrity depends on the release gate.** Payment and reversal helpers guard
    draft/cancelled records and use a truthful partial-payment fallback when historical receipt
    status is unavailable. The targeted and full database-backed suites must pass before real money
    is recorded.

---

## 7. Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately to the maintainer with steps
to reproduce, affected version/commit, and impact. Please allow a reasonable window for a fix before
disclosure; credit is given unless you ask otherwise.
