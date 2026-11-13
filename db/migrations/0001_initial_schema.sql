-- ============================================================================
-- Contractors Guild - Migration 0001: initial schema
--
-- Design notes
--  - All money is NUMERIC(14,2) (never floating point).
--  - All percentages are NUMERIC(5,2).
--  - Every business-owned table carries business_id so that row level
--    security (see 0002) can isolate tenants with one predicate.
--  - Child tables (quote_items, invoice_items) also carry business_id even
--    though it is derivable; this keeps isolation policies uniform and fast.
--  - No DELETE is granted to the application for financial records; records
--    are archived/cancelled through status changes instead.
-- ============================================================================

begin;

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------

create type public.customer_type as enum ('BUSINESS', 'INDIVIDUAL');

create type public.product_kind as enum ('PRODUCT', 'SERVICE');

create type public.job_status as enum (
  'LEAD',
  'QUOTED',
  'APPROVED',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
);

create type public.quote_status as enum (
  'DRAFT',
  'SENT',
  'VIEWED',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'CONVERTED'
);

create type public.invoice_status as enum (
  'DRAFT',
  'SENT',
  'VIEWED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CANCELLED'
);

create type public.payment_method as enum ('EFT', 'CASH', 'CARD', 'OTHER');

create type public.business_role as enum ('OWNER', 'ADMIN', 'STAFF', 'VIEWER');

create type public.membership_status as enum ('INVITED', 'ACTIVE', 'DISABLED');

create type public.document_type as enum ('JOB', 'QUOTE', 'INVOICE', 'RECEIPT');

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest
-- ---------------------------------------------------------------------------

create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Identity: users, sessions, password reset
-- ---------------------------------------------------------------------------

create table public.users (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  password_hash     text not null,
  full_name         text not null,
  phone             text,
  is_active         boolean not null default true,
  email_verified_at timestamptz,
  last_login_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint users_email_shape check (position('@' in email) > 1),
  constraint users_full_name_not_blank check (length(btrim(full_name)) > 0)
);

-- Case-insensitive uniqueness without depending on the citext extension.
create unique index users_email_lower_key on public.users (lower(email));

create trigger users_set_updated_at
  before update on public.users
  for each row execute function app.set_updated_at();

create table public.sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  ip_address   inet,
  user_agent   text,
  constraint sessions_expiry_after_creation check (expires_at > created_at)
);

create index sessions_user_id_idx on public.sessions (user_id);
create index sessions_expires_at_idx on public.sessions (expires_at);

create table public.password_reset_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz,
  constraint password_reset_expiry_after_creation check (expires_at > created_at)
);

create index password_reset_tokens_user_id_idx on public.password_reset_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Tenants: businesses, memberships, settings
-- ---------------------------------------------------------------------------

create table public.businesses (
  id                  uuid primary key default gen_random_uuid(),
  legal_name          text not null,
  trading_name        text,
  logo_url            text,
  logo_storage_key    text,
  registration_number text,
  tax_number          text,
  address_line1       text,
  address_line2       text,
  city                text,
  province            text,
  postal_code         text,
  country             text not null default 'South Africa',
  phone               text,
  email               text,
  website             text,
  whatsapp            text,
  currency_code       char(3) not null default 'ZAR',
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint businesses_legal_name_not_blank check (length(btrim(legal_name)) > 0),
  constraint businesses_currency_code_upper check (currency_code = upper(currency_code))
);

create index businesses_legal_name_idx on public.businesses (lower(legal_name));

create trigger businesses_set_updated_at
  before update on public.businesses
  for each row execute function app.set_updated_at();

create table public.business_users (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  role        public.business_role not null default 'STAFF',
  status      public.membership_status not null default 'ACTIVE',
  invited_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, user_id)
);

create index business_users_user_id_idx on public.business_users (user_id);
create index business_users_business_id_idx on public.business_users (business_id, status);

create trigger business_users_set_updated_at
  before update on public.business_users
  for each row execute function app.set_updated_at();

create table public.business_settings (
  business_id                uuid primary key references public.businesses(id) on delete cascade,
  default_payment_terms      text not null default 'Payment due on receipt',
  default_quote_validity_days integer not null default 30,
  default_tax_rate           numeric(5,2) not null default 15.00,
  quote_prefix               text not null default 'QUOTE-',
  invoice_prefix             text not null default 'INV-',
  receipt_prefix             text not null default 'REC-',
  bank_name                  text,
  bank_account_name          text,
  bank_account_number        text,
  bank_branch_code           text,
  bank_account_type          text,
  payment_instructions       text,
  invoice_footer_note        text default 'Thank you for your business.',
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint business_settings_quote_validity_range
    check (default_quote_validity_days between 1 and 365),
  constraint business_settings_tax_rate_range
    check (default_tax_rate >= 0 and default_tax_rate <= 100),
  constraint business_settings_prefix_len
    check (length(quote_prefix) between 0 and 12
       and length(invoice_prefix) between 0 and 12
       and length(receipt_prefix) between 0 and 12)
);

create trigger business_settings_set_updated_at
  before update on public.business_settings
  for each row execute function app.set_updated_at();

-- Atomic, duplicate-free document numbering (QUOTE-0001, INV-0001, ...).
create table public.document_sequences (
  business_id uuid not null references public.businesses(id) on delete cascade,
  doc_type    public.document_type not null,
  prefix      text not null default '',
  next_number integer not null default 1,
  updated_at  timestamptz not null default now(),
  primary key (business_id, doc_type),
  constraint document_sequences_next_number_positive check (next_number > 0),
  constraint document_sequences_prefix_len check (length(prefix) <= 12)
);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

create table public.customers (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses(id) on delete cascade,
  customer_type        public.customer_type not null default 'BUSINESS',
  business_name        text not null,
  contact_person       text,
  phone                text,
  email                text,
  billing_address_line1 text,
  billing_address_line2 text,
  billing_city         text,
  billing_province     text,
  billing_postal_code  text,
  billing_country      text default 'South Africa',
  site_address_line1   text,
  site_address_line2   text,
  site_city            text,
  site_province        text,
  site_postal_code     text,
  notes                text,
  is_active            boolean not null default true,
  created_by           uuid references public.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint customers_name_not_blank check (length(btrim(business_name)) > 0)
);

create index customers_business_name_idx on public.customers (business_id, lower(business_name));
create index customers_business_created_idx on public.customers (business_id, created_at desc);
create index customers_phone_idx on public.customers (business_id, phone);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Product & service catalogue
-- ---------------------------------------------------------------------------

create table public.products (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  kind          public.product_kind not null default 'SERVICE',
  name          text not null,
  description   text,
  category      text,
  unit          text not null default 'each',
  sku           text,
  default_price numeric(14,2) not null default 0,
  tax_rate      numeric(5,2) not null default 15.00,
  cost_price    numeric(14,2),
  is_active     boolean not null default true,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint products_name_not_blank check (length(btrim(name)) > 0),
  constraint products_default_price_non_negative check (default_price >= 0),
  constraint products_cost_price_non_negative check (cost_price is null or cost_price >= 0),
  constraint products_tax_rate_range check (tax_rate >= 0 and tax_rate <= 100)
);

create unique index products_business_name_key on public.products (business_id, lower(name));
create index products_business_active_idx on public.products (business_id, is_active, name);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------

create table public.jobs (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  customer_id        uuid not null references public.customers(id) on delete restrict,
  job_number         text not null,
  title              text not null,
  description        text,
  job_type           text,
  job_address_line1  text,
  job_address_line2  text,
  job_city           text,
  job_province       text,
  job_postal_code    text,
  scheduled_date     date,
  completed_date     date,
  status             public.job_status not null default 'LEAD',
  notes              text,
  created_by         uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (business_id, job_number),
  constraint jobs_title_not_blank check (length(btrim(title)) > 0),
  constraint jobs_schedule_order check (
    completed_date is null or scheduled_date is null or completed_date >= scheduled_date
  )
);

create index jobs_business_status_idx on public.jobs (business_id, status);
create index jobs_customer_idx on public.jobs (business_id, customer_id);
create index jobs_scheduled_idx on public.jobs (business_id, scheduled_date);

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Quotes
-- ---------------------------------------------------------------------------

create table public.quotes (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id) on delete cascade,
  customer_id         uuid not null references public.customers(id) on delete restrict,
  job_id              uuid references public.jobs(id) on delete set null,
  quote_number        text not null,
  status              public.quote_status not null default 'DRAFT',
  issue_date          date not null default current_date,
  valid_until         date,
  contact_person      text,
  contact_phone       text,
  contact_email       text,
  job_address_line1   text,
  job_address_line2   text,
  job_city            text,
  job_province        text,
  job_postal_code     text,
  job_type            text,
  description         text,
  subtotal            numeric(14,2) not null default 0,
  discount_total      numeric(14,2) not null default 0,
  tax_total           numeric(14,2) not null default 0,
  total               numeric(14,2) not null default 0,
  payment_terms       text,
  notes               text,
  terms_and_conditions text,
  public_token        text unique,
  sent_at             timestamptz,
  viewed_at           timestamptz,
  accepted_at         timestamptz,
  accepted_by_name    text,
  accepted_ip         inet,
  declined_at         timestamptz,
  declined_reason     text,
  converted_invoice_id uuid,
  created_by          uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (business_id, quote_number),
  constraint quotes_totals_non_negative
    check (subtotal >= 0 and discount_total >= 0 and tax_total >= 0 and total >= 0),
  constraint quotes_validity_order check (valid_until is null or valid_until >= issue_date)
);

create index quotes_business_status_idx on public.quotes (business_id, status);
create index quotes_business_issue_date_idx on public.quotes (business_id, issue_date desc);
create index quotes_customer_idx on public.quotes (business_id, customer_id);
create index quotes_job_idx on public.quotes (business_id, job_id);

create trigger quotes_set_updated_at
  before update on public.quotes
  for each row execute function app.set_updated_at();

create table public.quote_items (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  quote_id         uuid not null references public.quotes(id) on delete cascade,
  product_id       uuid references public.products(id) on delete set null,
  line_number      integer not null,
  description      text not null,
  quantity         numeric(12,3) not null default 1,
  unit             text not null default 'each',
  unit_price       numeric(14,2) not null default 0,
  discount_percent numeric(5,2) not null default 0,
  tax_rate         numeric(5,2) not null default 15.00,
  line_subtotal    numeric(14,2) not null default 0,
  line_discount    numeric(14,2) not null default 0,
  line_tax         numeric(14,2) not null default 0,
  line_total       numeric(14,2) not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (quote_id, line_number),
  constraint quote_items_description_not_blank check (length(btrim(description)) > 0),
  constraint quote_items_quantity_positive check (quantity > 0),
  constraint quote_items_unit_price_non_negative check (unit_price >= 0),
  constraint quote_items_discount_range check (discount_percent >= 0 and discount_percent <= 100),
  constraint quote_items_tax_rate_range check (tax_rate >= 0 and tax_rate <= 100),
  constraint quote_items_totals_non_negative
    check (line_subtotal >= 0 and line_discount >= 0 and line_tax >= 0 and line_total >= 0)
);

create index quote_items_quote_idx on public.quote_items (business_id, quote_id, line_number);

create trigger quote_items_set_updated_at
  before update on public.quote_items
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------

create table public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id) on delete cascade,
  customer_id         uuid not null references public.customers(id) on delete restrict,
  job_id              uuid references public.jobs(id) on delete set null,
  quote_id            uuid references public.quotes(id) on delete set null,
  invoice_number      text not null,
  status              public.invoice_status not null default 'DRAFT',
  issue_date          date not null default current_date,
  due_date            date,
  prepared_by         text,
  contact_person      text,
  contact_phone       text,
  contact_email       text,
  billing_address_line1 text,
  billing_address_line2 text,
  billing_city        text,
  billing_province    text,
  billing_postal_code text,
  job_address_line1   text,
  job_address_line2   text,
  job_city            text,
  job_province        text,
  job_postal_code     text,
  job_type            text,
  description         text,
  subtotal            numeric(14,2) not null default 0,
  discount_total      numeric(14,2) not null default 0,
  tax_total           numeric(14,2) not null default 0,
  total               numeric(14,2) not null default 0,
  amount_paid         numeric(14,2) not null default 0,
  balance_due         numeric(14,2) generated always as (total - amount_paid) stored,
  payment_terms       text,
  notes               text,
  terms_and_conditions text,
  public_token        text unique,
  sent_at             timestamptz,
  viewed_at           timestamptz,
  paid_at             timestamptz,
  cancelled_at        timestamptz,
  created_by          uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (business_id, invoice_number),
  constraint invoices_totals_non_negative
    check (subtotal >= 0 and discount_total >= 0 and tax_total >= 0 and total >= 0),
  constraint invoices_amount_paid_range check (amount_paid >= 0 and amount_paid <= total),
  constraint invoices_due_date_order check (due_date is null or due_date >= issue_date)
);

create index invoices_business_status_idx on public.invoices (business_id, status);
create index invoices_business_issue_date_idx on public.invoices (business_id, issue_date desc);
create index invoices_business_due_date_idx on public.invoices (business_id, due_date);
create index invoices_customer_idx on public.invoices (business_id, customer_id);
create index invoices_quote_idx on public.invoices (quote_id);

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function app.set_updated_at();

create table public.invoice_items (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  invoice_id       uuid not null references public.invoices(id) on delete cascade,
  product_id       uuid references public.products(id) on delete set null,
  line_number      integer not null,
  description      text not null,
  quantity         numeric(12,3) not null default 1,
  unit             text not null default 'each',
  unit_price       numeric(14,2) not null default 0,
  discount_percent numeric(5,2) not null default 0,
  tax_rate         numeric(5,2) not null default 15.00,
  line_subtotal    numeric(14,2) not null default 0,
  line_discount    numeric(14,2) not null default 0,
  line_tax         numeric(14,2) not null default 0,
  line_total       numeric(14,2) not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (invoice_id, line_number),
  constraint invoice_items_description_not_blank check (length(btrim(description)) > 0),
  constraint invoice_items_quantity_positive check (quantity > 0),
  constraint invoice_items_unit_price_non_negative check (unit_price >= 0),
  constraint invoice_items_discount_range check (discount_percent >= 0 and discount_percent <= 100),
  constraint invoice_items_tax_rate_range check (tax_rate >= 0 and tax_rate <= 100),
  constraint invoice_items_totals_non_negative
    check (line_subtotal >= 0 and line_discount >= 0 and line_tax >= 0 and line_total >= 0)
);

create index invoice_items_invoice_idx on public.invoice_items (business_id, invoice_id, line_number);

create trigger invoice_items_set_updated_at
  before update on public.invoice_items
  for each row execute function app.set_updated_at();

-- Quote -> invoice relationship (both directions, enforced by the database).
alter table public.quotes
  add constraint quotes_converted_invoice_fk
  foreign key (converted_invoice_id) references public.invoices(id) on delete set null;

-- A quote can produce at most one invoice through the standard conversion path.
create unique index invoices_quote_unique_idx on public.invoices (quote_id) where quote_id is not null;

-- ---------------------------------------------------------------------------
-- Payments and receipts
-- ---------------------------------------------------------------------------

create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  invoice_id   uuid not null references public.invoices(id) on delete restrict,
  customer_id  uuid not null references public.customers(id) on delete restrict,
  amount       numeric(14,2) not null,
  payment_date date not null default current_date,
  method       public.payment_method not null default 'EFT',
  reference    text,
  notes        text,
  recorded_by  uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint payments_amount_positive check (amount > 0)
);

create index payments_business_date_idx on public.payments (business_id, payment_date desc);
create index payments_invoice_idx on public.payments (business_id, invoice_id);
create index payments_customer_idx on public.payments (business_id, customer_id);

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function app.set_updated_at();

create table public.receipts (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  payment_id        uuid not null references public.payments(id) on delete restrict,
  invoice_id        uuid not null references public.invoices(id) on delete restrict,
  customer_id       uuid not null references public.customers(id) on delete restrict,
  receipt_number    text not null,
  issued_at         timestamptz not null default now(),
  amount_received   numeric(14,2) not null,
  previous_balance  numeric(14,2) not null,
  remaining_balance numeric(14,2) not null,
  method            public.payment_method not null,
  reference         text,
  public_token      text unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (business_id, receipt_number),
  constraint receipts_amount_positive check (amount_received > 0),
  constraint receipts_balances_non_negative check (previous_balance >= 0 and remaining_balance >= 0)
);

create index receipts_invoice_idx on public.receipts (business_id, invoice_id);
create index receipts_business_issued_idx on public.receipts (business_id, issued_at desc);

create trigger receipts_set_updated_at
  before update on public.receipts
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit trail for sensitive actions (authentication, acceptance, payments)
-- ---------------------------------------------------------------------------

create table public.audit_events (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  user_id     uuid references public.users(id) on delete set null,
  event_type  text not null,
  entity_type text,
  entity_id   uuid,
  metadata    jsonb not null default '{}'::jsonb,
  ip_address  inet,
  created_at  timestamptz not null default now()
);

create index audit_events_business_idx on public.audit_events (business_id, created_at desc);
create index audit_events_type_idx on public.audit_events (business_id, event_type);

commit;
