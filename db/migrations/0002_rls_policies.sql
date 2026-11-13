-- ============================================================================
-- Contractors Guild - Migration 0002: row level security
--
-- Tenant isolation model
--  - Every request runs inside a transaction that sets two session variables:
--        app.user_id      -> the authenticated user
--        app.business_id  -> the business currently selected in that session
--    Both values are derived SERVER-SIDE from the session cookie. Client input
--    never reaches set_config().
--  - Business-owned tables are protected with FORCE ROW LEVEL SECURITY so the
--    restriction applies to the table owner as well as the application role.
--  - Policies require BOTH the business id to match the active business AND
--    an active membership row for the authenticated user (defence in depth:
--    even a wrong app.business_id cannot read another tenant's rows).
--  - Hard DELETE is deliberately not granted on business records. Records are
--    archived (is_active = false) or cancelled through status changes so that
--    financial history cannot silently disappear.
--
-- NOTE FOR OPERATORS: the migration (owner) role must be able to bypass RLS
-- for the helper functions below to read membership rows without recursion.
-- Use a role with SUPERUSER or BYPASSRLS (Supabase's `postgres` role qualifies).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Request context helpers
-- ---------------------------------------------------------------------------

create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;

create or replace function app.current_business_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.business_id', true), '')::uuid;
$$;

-- Membership check. SECURITY DEFINER so it can read business_users without
-- triggering the business_users policy (which itself calls this function).
create or replace function app.is_member_of(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.business_users bu
    where bu.business_id = p_business_id
      and bu.user_id = app.current_user_id()
      and bu.status = 'ACTIVE'
  );
$$;

-- ---------------------------------------------------------------------------
-- Standard tenant policy bundle for business-owned tables
-- ---------------------------------------------------------------------------

create or replace function app.apply_business_scope_policies(p_table text)
returns void
language plpgsql
as $$
declare
  v_scope constant text :=
    'business_id = app.current_business_id() and app.is_member_of(business_id)';
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('alter table public.%I force row level security', p_table);

  execute format('drop policy if exists %I on public.%I', p_table || '_select', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_insert', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_update', p_table);

  execute format(
    'create policy %I on public.%I for select to public using (%s)',
    p_table || '_select', p_table, v_scope
  );
  execute format(
    'create policy %I on public.%I for insert to public with check (%s)',
    p_table || '_insert', p_table, v_scope
  );
  execute format(
    'create policy %I on public.%I for update to public using (%s) with check (%s)',
    p_table || '_update', p_table, v_scope, v_scope
  );
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'customers',
    'products',
    'jobs',
    'quotes',
    'quote_items',
    'invoices',
    'invoice_items',
    'payments',
    'receipts',
    'document_sequences',
    'business_settings'
  ]
  loop
    perform app.apply_business_scope_policies(v_table);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Identity tables
-- ---------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.users force row level security;

-- A user can only ever see and change their own identity row. Registration
-- sets app.user_id to the id being created inside the same transaction.
create policy users_select on public.users
  for select to public using (id = app.current_user_id());
create policy users_insert on public.users
  for insert to public with check (id = app.current_user_id());
create policy users_update on public.users
  for update to public using (id = app.current_user_id())
  with check (id = app.current_user_id());

alter table public.sessions enable row level security;
alter table public.sessions force row level security;

create policy sessions_select on public.sessions
  for select to public using (user_id = app.current_user_id());
create policy sessions_insert on public.sessions
  for insert to public with check (user_id = app.current_user_id());
create policy sessions_update on public.sessions
  for update to public using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());
create policy sessions_delete on public.sessions
  for delete to public using (user_id = app.current_user_id());

alter table public.password_reset_tokens enable row level security;
alter table public.password_reset_tokens force row level security;

-- Reset tokens are only reachable through app.auth_create_reset /
-- app.auth_consume_reset_and_set_password (SECURITY DEFINER). A signed-in user
-- can additionally see their own outstanding tokens.
create policy password_reset_tokens_select on public.password_reset_tokens
  for select to public using (user_id = app.current_user_id());
create policy password_reset_tokens_delete on public.password_reset_tokens
  for delete to public using (user_id = app.current_user_id());

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------

alter table public.businesses enable row level security;
alter table public.businesses force row level security;

create policy businesses_select on public.businesses
  for select to public
  using (id = app.current_business_id() and app.is_member_of(id));

-- During registration no membership row exists yet, so insert is bound to the
-- freshly generated business id only (set server-side in the registration
-- transaction, never from client input).
create policy businesses_insert on public.businesses
  for insert to public with check (id = app.current_business_id());

create policy businesses_update on public.businesses
  for update to public
  using (id = app.current_business_id() and app.is_member_of(id))
  with check (id = app.current_business_id() and app.is_member_of(id));

alter table public.business_users enable row level security;
alter table public.business_users force row level security;

create policy business_users_select on public.business_users
  for select to public
  using (user_id = app.current_user_id() or app.is_member_of(business_id));

create policy business_users_insert on public.business_users
  for insert to public
  with check (user_id = app.current_user_id() or app.is_member_of(business_id));

create policy business_users_update on public.business_users
  for update to public
  using (app.is_member_of(business_id))
  with check (app.is_member_of(business_id));

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------

alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;

create policy audit_events_select on public.audit_events
  for select to public
  using (business_id = app.current_business_id() and app.is_member_of(business_id));

-- Sign-in events happen before a business is selected, so a user may record an
-- event against themselves with a null business_id. Business events must match
-- the active business.
create policy audit_events_insert on public.audit_events
  for insert to public
  with check (
    (business_id = app.current_business_id() and app.is_member_of(business_id))
    or (business_id is null and user_id = app.current_user_id())
  );

-- No update/delete policies: the audit trail is append-only for the app role.

commit;
