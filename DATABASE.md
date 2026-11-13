# Contractors Guild — Database

PostgreSQL schema, relationships, indexes and the row level security model that keeps one
contractor's data invisible to every other contractor.

Schema version: **migrations 0001–0009** (see [§7](#7-migration-history)). Apply pending migrations
with `npm run db:migrate`.

---

## 1. Design principles

1. **Every business-owned row carries `business_id`.** Isolation is a column, not a join chain, so a
   policy can be applied table by table without touching query shapes.
2. **The database enforces isolation.** `ENABLE` + `FORCE ROW LEVEL SECURITY` is applied to all
   tenant tables, and the application connects as a role that cannot bypass it. Application-level
   checks are additional defence, never the only one.
3. **Money is `NUMERIC(14,2)`.** The application works in integer cents and only ever writes
   two-decimal values, so totals round-trip without drift. No floating point is used for money.
4. **Business records are never deleted by the application.** No tenant table has a `DELETE`
   policy, so with row level security forced, deletion is denied (PostgreSQL denies the command
   when no policy applies). Corrections are status changes or new rows, which keeps numbering and
   audit trails intact; only a session or password-reset token can be deleted, and only by its
   owner.
5. **Documents are immutable once issued.** Line items are written together with their parent
   document; a quote that is converted to an invoice leaves the quote untouched.
6. **Sequences are per business and transactional**, so a rolled-back transaction does not burn a
   number and two users can never receive the same one.

---

## 2. Roles and schemas

| Role | Used by | Properties |
| --- | --- | --- |
| `cg_admin` (dev default) | `DATABASE_ADMIN_URL` — migrations and `db:*` scripts | `SUPERUSER`; never used by the running application |
| `cg_app` | `DATABASE_URL` — the application | `LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`; subject to every policy |

Role names and passwords come from the environment, so production can supply its own. Anything that
must see across tenants (migrations, tests) uses the admin connection explicitly.

| Schema | Contents |
| --- | --- |
| `public` | Application tables, enums, triggers |
| `app` | `SECURITY DEFINER` helpers: context accessors, membership check, authentication lookups |

`app` functions are revoked from `PUBLIC` and granted only to the application role. Each one fixes
its `search_path` and takes explicit parameters, so it cannot be used to read around a policy.

---

## 3. Enumerated types

| Type | Values |
| --- | --- |
| `customer_type` | `BUSINESS`, `INDIVIDUAL` |
| `product_kind` | `PRODUCT`, `SERVICE` |
| `job_status` | `LEAD`, `QUOTED`, `APPROVED`, `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` |
| `quote_status` | `DRAFT`, `SENT`, `VIEWED`, `ACCEPTED`, `DECLINED`, `EXPIRED`, `CONVERTED` |
| `invoice_status` | `DRAFT`, `SENT`, `VIEWED`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `CANCELLED` |
| `payment_method` | `EFT`, `CASH`, `CARD`, `OTHER` |
| `business_role` | `OWNER`, `ADMIN`, `STAFF`, `VIEWER` |
| `membership_status` | `INVITED`, `ACTIVE`, `DISABLED` |
| `document_type` | `JOB`, `QUOTE`, `INVOICE`, `RECEIPT` |

Enums are used instead of free text so invalid states cannot be stored even by a buggy or malicious
client.

---

## 4. Tables

### Identity and tenancy

| Table | Purpose | Columns |
| --- | --- | --- |
| `users` | Login identities | `email` (unique on `lower(email)`), `password_hash`, `full_name`, `phone`, `is_active`, `email_verified_at`, `last_login_at` |
| `sessions` | Server-side sessions | `user_id`, `token_hash` (unique), `last_seen_at`, `expires_at`, `revoked_at`, `ip_address`, `user_agent` |
| `password_reset_tokens` | Single-use reset links | `user_id`, `token_hash` (unique), `expires_at`, `used_at` |
| `businesses` | The contracting business | `legal_name`, `trading_name`, `registration_number`, `tax_number`, `logo_url`, `logo_storage_key`, `address_line1/2`, `city`, `province`, `postal_code`, `country`, `phone`, `email`, `website`, `whatsapp`, `currency_code` (default `ZAR`), `is_active` |
| `business_users` | Membership + role | unique `(business_id, user_id)`, `role`, `status`, `invited_by`, `joined_at` |
| `business_settings` | Per-business configuration | `default_payment_terms`, `default_quote_validity_days`, `default_tax_rate`, `quote_prefix`, `invoice_prefix`, `receipt_prefix`, `bank_name`, `bank_account_name`, `bank_account_number`, `bank_branch_code`, `bank_account_type`, `payment_instructions`, `invoice_footer_note` |
| `audit_events` | Append-only trail | `business_id`, `user_id`, `event_type`, `entity_type`, `entity_id`, `metadata` (jsonb), `ip_address` |

A session does not store a business id: `app.auth_find_session()` resolves the user's earliest
`ACTIVE` membership, which keeps sessions valid while a user's business membership changes and makes
multi-business support a query change rather than a migration.

**Banking details exist only in `business_settings`, per business.** No banking data, credential or
reference-invoice customer detail is compiled into the application.

### Customers and catalogue

| Table | Purpose | Columns |
| --- | --- | --- |
| `customers` | Customer records | `customer_type`, `business_name`, `contact_person`, `phone`, `email`, `billing_address_line1/2`, `billing_city`, `billing_province`, `billing_postal_code`, `billing_country`, `site_address_line1/2`, `site_city`, `site_province`, `site_postal_code`, `notes`, `is_active`, `created_by` |
| `products` | Catalogue — items and labour | `kind` (`PRODUCT`/`SERVICE`), `name`, `description`, `category`, `unit`, `sku`, `default_price` `NUMERIC(14,2)`, `tax_rate` `NUMERIC(5,2)` (default 15.00), `cost_price`, `is_active` |

One catalogue table with a `kind` discriminator covers both stocked items and labour/services, so
the quote builder queries a single source for autocomplete and pricing. `unique (business_id,
lower(name))` keeps the catalogue tidy — the app turns that constraint into a friendly "that item
already exists" message instead of a database error.

Customers are never deleted: `is_active` archives them, and a possible duplicate (same name or
phone) is reported by the app so an accidental second record is a deliberate choice rather than a
surprise. Job counts, quote counts and outstanding balances shown on the customer list are computed
with lateral aggregates over the tenant's own rows, so the numbers can never be stale copies.

### Jobs

| Table | Purpose | Columns |
| --- | --- | --- |
| `jobs` | The work itself | `job_number` (unique per business), `customer_id`, `title`, `description`, `job_type`, `job_address_line1/2`, `job_city`, `job_province`, `job_postal_code`, `scheduled_date`, `completed_date`, `status`, `notes`, `created_by` |

Status flow: `LEAD → QUOTED → APPROVED → SCHEDULED → IN_PROGRESS → COMPLETED`, with `CANCELLED` from
any point and `COMPLETED → IN_PROGRESS` for rework. `scheduled_date` and `completed_date` are `DATE`
because a contractor schedules days, not instants; `completed_date` is set when a job reaches
`COMPLETED` and cleared if it is reopened.

Job numbers come from the same row-locked sequence as quotes and invoices (`JOB-0001`), restarting
per business, and `unique (business_id, job_number)` is the backstop. When a job is created without
a site address the repository copies the customer's site address, so a contractor never retypes it.
The legal transitions live in `lib/jobs.ts` and are validated before every write; the audit trail
records each real move with its `from`/`to` values.

### Quotes

| Table | Purpose | Columns |
| --- | --- | --- |
| `quotes` | Customer-facing offers | `quote_number` (unique per business), `customer_id`, `job_id`, `status`, `issue_date`, `valid_until`, `contact_person`, `contact_phone`, `contact_email`, `job_address_*`, `job_type`, `description`, `subtotal`, `discount_total`, `tax_total`, `total`, `payment_terms`, `notes`, `terms_and_conditions`, `public_token` (unique), `sent_at`, `viewed_at`, `accepted_at`, `accepted_by_name`, `accepted_ip` (inet), `declined_at`, `declined_reason`, `converted_invoice_id` |
| `quote_items` | Line items | `quote_id` (cascade), `product_id`, `line_number`, `description`, `quantity` `NUMERIC(12,3)`, `unit`, `unit_price` `NUMERIC(14,2)`, `discount_percent` `NUMERIC(5,2)`, `tax_rate`, `line_subtotal`, `line_discount`, `line_tax`, `line_total` |

The customer-facing fields are **copied onto the document** at creation time (contact, job address,
job type, description). Issuing a document therefore freezes what the customer saw, even if the
customer record is later edited.

Quote status: `DRAFT → SENT → VIEWED → ACCEPTED` (or `DECLINED` / `EXPIRED`), then `CONVERTED` once
invoiced. `public_token` powers the Phase 3 acceptance page: the link is unguessable, the customer
can read the document and accept it, and the acceptance records `accepted_at`,
`accepted_by_name` and `accepted_ip`. Pricing fields are never writable through that path — the
public route only ever performs the acceptance update.

### Invoices, payments, receipts

| Table | Purpose | Columns |
| --- | --- | --- |
| `invoices` | Tax invoices | `invoice_number` (unique per business), `customer_id`, `job_id`, `quote_id`, `status`, `issue_date`, `due_date`, `prepared_by`, `contact_*`, `billing_address_*`, `job_address_*`, `job_type`, `description`, `subtotal`, `discount_total`, `tax_total`, `total`, `amount_paid`, `balance_due` (**generated**: `total - amount_paid`), `payment_terms`, `notes`, `terms_and_conditions`, `public_token`, `sent_at`, `viewed_at`, `paid_at`, `cancelled_at` |
| `invoice_items` | Line items | same shape as `quote_items`, tied to `invoice_id` |
| `payments` | Money received | `invoice_id`, `customer_id`, `amount` `NUMERIC(14,2)`, `payment_date` `DATE`, `method`, `reference`, `notes`, `recorded_by`, `receipt_number` |
| `receipts` | Issued receipts | `payment_id`, `invoice_id`, `customer_id`, `receipt_number` (unique per business), `issued_at`, `amount_received`, `previous_balance`, `remaining_balance`, `method`, `reference`, `public_token`, `status_before` |

`balance_due` is a generated column, so the outstanding amount can never disagree with the totals it
derives from. A partial unique index (`invoices (quote_id) WHERE quote_id IS NOT NULL`) guarantees at
most one invoice per quote, making quote→invoice conversion idempotent even if the user double-clicks.

Invoice status: `DRAFT`, `SENT`, `VIEWED`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `CANCELLED`.
Transitions are driven by payments: a payment smaller than the balance yields `PARTIALLY_PAID`, a
payment clearing the balance yields `PAID` and stamps `paid_at`, and overdue is computed from
`due_date` for reporting rather than being stored stale.

Payment recording is one transaction: the invoice row is locked, overpayment is refused, the
invoice balance/status is updated, and a receipt number plus receipt snapshot is written. Reversal
does not delete financial rows; `receipts.status_before` supports the status walk-back while the
payment, receipt and audit trail remain available.

### Numbering

| Table | Purpose | Columns |
| --- | --- | --- |
| `document_sequences` | Per-business counters | primary key `(business_id, doc_type)`, `prefix`, `next_number` |

Allocation is a single statement inside the caller's transaction
(`lib/numbering.ts`):

```sql
insert into document_sequences (business_id, doc_type, prefix, next_number)
values ($1, $2, $3, 2)
on conflict (business_id, doc_type) do update
  set next_number = document_sequences.next_number + 1,
      prefix = excluded.prefix,
      updated_at = now()
returning next_number, prefix;   -- number = prefix || lpad(next_number - 1, 4, '0')
```

The `ON CONFLICT` update takes a row lock on `(business_id, doc_type)`, so concurrent callers
serialise instead of colliding, and a rollback releases the number. Defaults are `JOB-`, `QUOTE-`,
`INV-`, `REC-` with 4-digit padding, overridable per business in settings; `unique (business_id,
<number column>)` on `jobs`, `quotes`, `invoices` and `receipts` is the final backstop.

---

## 5. Relationships

```text
users ──┬─< business_users >── businesses ──┬─ business_settings (1:1)
        │                                    ├─< document_sequences
        └─< sessions                         ├─< customers ──┬─< jobs ──┬─< quotes ──< quote_items
                                             │                │         └─< invoices ──< invoice_items
                                             │                │                │
                                             │                └────────────────┴─< payments ──< receipts
                                             └─< audit_events
```

- `quotes.customer_id → customers`, `quotes.job_id → jobs`, `quotes.converted_invoice_id → invoices`
- `invoices.quote_id → quotes`, `invoices.job_id → jobs`, `invoices.customer_id → customers`
- `payments.invoice_id → invoices`, `payments.customer_id → customers`
- `receipts.payment_id → payments`, `receipts.invoice_id → invoices`, `receipts.customer_id → customers`
- `quotes.converted_invoice_id → invoices` closes the conversion loop (both sides nullable, so the
  pair never deadlocks a transaction)

Deletion rules: line items cascade with their document; business-owned tables cascade from
`businesses`; customers referenced by jobs/quotes/invoices restrict deletion; optional references
(`job_id`, `product_id`, `created_by`) null out. Financial parents are never cascaded away.

### Indexes

| Index | Purpose |
| --- | --- |
| `users_email_lower_key` (unique, `lower(email)`) | Case-insensitive sign-in |
| `business_users_business_id_idx (business_id, status)` | Membership checks inside every policy |
| `customers_business_name_idx (business_id, lower(business_name))` | Customer list and autocomplete |
| `customers_phone_idx (business_id, phone)` | Phone lookup |
| `products_business_active_idx (business_id, is_active, name)` | Catalogue and quote-builder picker |
| `products_business_name_key` (unique, `lower(name)`) | No duplicate catalogue entries |
| `jobs_business_status_idx`, `jobs_scheduled_idx` | Job board, scheduling |
| `quotes_business_status_idx`, `quotes_business_issue_date_idx` | Quote pipeline, newest first |
| `invoices_business_status_idx`, `invoices_business_due_date_idx` | Outstanding and overdue reports |
| `payments_business_date_idx`, `receipts_business_issued_idx` | Revenue reporting, receipt history |
| unique `public_token` on `quotes`, `invoices`, `receipts` | Safe public lookups |
| `audit_events_business_idx`, `audit_events_type_idx` | Activity feeds, security review |

Every index is prefixed by `business_id`, matching the access pattern of a tenant-scoped application.

---

## 6. Row level security

### Context

Every tenant transaction begins with:

```sql
select set_config('app.user_id',     $1, true),
       set_config('app.business_id', $2, true);
```

The third argument `true` makes the settings **transaction-local**, so they cannot leak into a later
request that reuses the pooled connection. `app.current_user_id()` and `app.current_business_id()`
read them back as `uuid`, returning `NULL` when unset.

`lib/db/index.ts` performs this inside `withContext({ userId, businessId })`, and every repository
call runs inside it.

### Policy bundle

`app.apply_business_scope_policies(table)` applies the same three policies to each tenant table:

```sql
scope := 'business_id = app.current_business_id() and app.is_member_of(business_id)';

create policy <table>_select on <table> for select using (scope);
create policy <table>_insert on <table> for insert with check (scope);
create policy <table>_update on <table> for update using (scope) with check (scope);
```

with `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY` issued for each table.

`app.is_member_of(uuid)` is `SECURITY DEFINER` and returns true only when an `ACTIVE`
`business_users` row links `app.current_user_id()` to that business. Because the scope requires both
membership **and** the active business, a request can only ever touch the tenant it is acting in —
even a user who belongs to two businesses cannot mix their data in one request.

Covered by the bundle: `customers`, `products`, `jobs`, `quotes`, `quote_items`, `invoices`,
`invoice_items`, `payments`, `receipts`, `document_sequences`, `business_settings`.

The bundle grants `select`, `insert` and `update` only. Deletion of business records is deliberately
impossible for the application role — records are archived (`is_active = false`) or moved to a
terminal status, so financial history cannot silently disappear. The single exception is migration
`0006`, which adds a `delete` policy on `quote_items` and only allows it while the parent quote is
still a `DRAFT` (`quote_items_delete`, using an `exists` check on the quote's status). That is what
lets the builder replace the lines of a draft; the same statement against a sent, accepted or
invoiced quote matches no rows.

Identity tables have tailored policies instead of the bundle:

| Table | Rule |
| --- | --- |
| `users` | A user may read and update only their own row. Registration sets `app.user_id` to the row being created in the same transaction. |
| `sessions` | A user sees only their own sessions; inserts are allowed for the user the transaction is acting for. |
| `password_reset_tokens` | Own tokens only; creation and consumption happen inside `app` definer functions. |
| `businesses` | Read when `app.is_member_of(id)` (so a user's businesses can be listed while signing in); write only for the active business. |
| `business_users` | Visible to members of that business; membership rows for the active business only. |
| `audit_events` | Append-only for the application role: an insert policy (active business, or a user recording their own pre-business sign-in event) and a select policy, with no update or delete policy. |

### The public quote surface

The customer-facing quote page is the one part of the product that runs **without a session**. It
never touches tenant tables directly: everything goes through three `SECURITY DEFINER` functions in
the `app` schema, executed with a pinned `search_path` and revoked from `PUBLIC`:

| Function | Purpose |
| --- | --- |
| `app.public_quote(token)` | Returns one `jsonb` document — quote, business, customer and item rows — for an unguessable token. It returns explicit columns only (no internal ids, no other customers, no banking details) and `NULL` for anything else. |
| `app.public_quote_mark_viewed(token)` | Stamps `viewed_at` and moves `SENT → VIEWED` the first time the page is opened, and appends a `quote.viewed` audit row. |
| `app.public_quote_respond(token, decision, name, reason, ip, user_agent)` | Records an acceptance (`accepted_at`, `accepted_by_name`, `accepted_ip`) or a decline, appends the audit row, and returns a reason code (`not_found`, `not_sent`, `not_open`, `expired`, `name_required`, `invalid_decision`) when it refuses. |

`app.public_quote_logo_key(token)` (migration `0007`) returns just the storage key of the business's
own logo so the public page can show the letterhead. Because these functions are the owner of the
tenant tables, they bypass row level security — which is exactly why they take a token instead of an
id, return a fixed shape, and can only ever write the acceptance/decline columns of the one quote
that token points at. Prices, totals and line items are read-only through this path.

### What this guarantees (and what the tests assert)

- Selecting another business's customers, quotes or invoices returns **zero rows** — the policy
  filters them whether or not the query remembered to.
- Inserting a row with a foreign `business_id` raises
  `new row violates row-level security policy for table …`.
- Updating or deleting another business's row affects **no rows**.
- A `businessId` submitted in a form is ignored: actions take the tenant from the session, so a
  forged value cannot widen access (asserted in `tests/integration/business-profile.test.ts`).
- Anonymous authentication outcomes are recorded with a null actor and are not readable through the
  application role (migration 0005).

### Deliberate limitation

One session acts in one business at a time (the earliest `ACTIVE` membership). Full multi-business
switching — a business picker and an explicit "acting as" switch — belongs to the multi-staff phase;
the `business_users` model and the `app.business_id` context already support it.

---

## 7. Migration history

| File | Contents |
| --- | --- |
| `0001_initial_schema.sql` | Enums, 17 tables, constraints (money non-negative, quantity positive, percentages 0–100, date ordering), generated `balance_due`, indexes, `updated_at` triggers, one-invoice-per-quote partial unique index |
| `0002_rls_policies.sql` | `app.current_user_id()`, `app.current_business_id()`, `app.is_member_of()`, `app.apply_business_scope_policies()`, per-table policies, `FORCE ROW LEVEL SECURITY`, append-only audit (no update/delete policies), no delete policy on tenant tables |
| `0003_auth_helpers.sql` | `app.auth_find_user()`, `app.auth_find_session()`, `app.auth_create_reset()`, `app.auth_consume_reset()`, `app.grant_app_role()` — `SECURITY DEFINER`, `search_path` pinned, `PUBLIC` revoked |
| `0004_business_membership_read.sql` | Relaxes the `businesses` SELECT policy to `app.is_member_of(id)` so a user's businesses resolve during sign-in; writes still require the active business |
| `0005_anonymous_auth_audit.sql` | Permits anonymous authentication audit rows (`auth.%` events with `user_id`/`business_id` null) so failed sign-ins for unknown emails are still recorded |
| `0006_public_quotes.sql` | `quote_items_delete` policy (draft lines only) and the public quote functions `app.public_quote`, `app.public_quote_mark_viewed`, `app.public_quote_respond` — `SECURITY DEFINER`, pinned `search_path`, `PUBLIC` revoked |
| `0007_public_quote_logo.sql` | Redefines `app.public_quote` to include the customer's billing address, and adds `app.public_quote_logo_key(token)` for the public letterhead |
| `0008_draft_invoice_lines.sql` | Adds a draft-only `invoice_items_delete` policy so line sets can be replaced while an invoice is editable; issued invoices remain immutable |
| `0009_payment_receipt_numbers.sql` | Adds `payments.receipt_number`, `receipts.status_before` and a partial unique index on non-null payment receipt numbers for the Phase 5 payment/reversal workflow |

Migrations are ordered, plain SQL, applied by `scripts/db.mjs`, which records applied versions and
skips them on later runs. History is never edited: new behaviour arrives as a new numbered file,
exactly as 0004 and 0005 did.

Phase 1 shipped this schema in full, so **Phase 2 added no migration** — customers, products,
jobs, `document_sequences` and `audit_events` were already defined with their constraints, indexes
and policies. Application code was written against the existing tables rather than reshaping them,
which is the point of designing the schema for the whole product up front.

**Phase 3 added two**, because the quote module needed two things the original schema could not
express: a way to replace the lines of a draft (the `quote_items_delete` policy) and a way to read a
single quote without a session (the public functions). No table, column or constraint was changed or
removed; `0007` only widens what `app.public_quote` returns.

**Phase 4 added migration 0008** to allow line replacement only while an invoice is `DRAFT`.
**Phase 5 added migration 0009** for the receipt number displayed with each payment and the prior
invoice status retained by each receipt. Future changes must continue as new numbered migrations;
applied migration history must not be rewritten.

---

## 8. Local development

```bash
npm run db:setup      # initdb + start + roles + databases + migrate  (first time)
npm run db:start      # start the cluster
npm run db:status     # report process and database state
npm run db:migrate    # apply pending migrations
npm run db:seed       # demo tenant with customers, catalogue, jobs, quotes, invoices and payments
npm run db:seed -- --force   # rebuild that demo tenant from scratch
npm run db:reset      # DESTRUCTIVE: recreate the development database
npm run db:stop       # stop the cluster
```

- Cluster data directory: `data/pg` (git ignored — never commit a database).
- Connection: `postgresql://<app-user>:<password>@127.0.0.1:5433/contractors_guild`.
- The test suite uses `contractors_guild_test`: it applies all migrations itself and truncates
  tenant tables between runs. Use only a disposable test database. Setting `TEST_DATABASE_URL`
  points the suite at an external disposable database for CI; never point it at development or
  production data.
- Uploaded logos are written under `STORAGE_LOCAL_DIR` (`data/uploads`, git ignored) and served only
  through `/api/businesses/[businessId]/logo` after a session and tenant check, or through
  `/q/[token]/logo` for a customer holding a quote token.
- `db:seed` prints the customer link of every quote it marks as sent, so the public acceptance page
  can be opened from a terminal without signing in.
