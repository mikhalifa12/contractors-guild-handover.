-- ============================================================================
-- Contractors Guild - Migration 0003: authentication helper functions
--
-- These are the ONLY queries that may read authentication data before the
-- request context (app.user_id / app.business_id) exists:
--
--   app.auth_find_user(email)                       - sign-in password check
--   app.auth_find_session(token_hash)               - cookie -> session/tenant
--   app.auth_create_reset(email, hash, expires)     - password reset request
--   app.auth_consume_reset_and_set_password(...)    - password reset completion
--   app.grant_app_role(role)                        - operator helper
--
-- They are SECURITY DEFINER (owned by the migration role, which bypasses RLS),
-- return only the columns the flow needs, and are revoked from PUBLIC so that
-- only the explicitly granted application role can call them.
--
-- Design notes
--  - Every function returns nothing for "no match"; callers cannot use them to
--    enumerate accounts beyond the single email/token they already hold.
--  - Password reset is a single atomic call so that "reset token is valid" and
--    "password is changed" can never drift apart.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Sign-in lookup
-- ---------------------------------------------------------------------------

create or replace function app.auth_find_user(p_email text)
returns table (
  id            uuid,
  email         text,
  password_hash text,
  full_name     text,
  is_active     boolean
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select u.id, u.email, u.password_hash, u.full_name, u.is_active
  from public.users u
  where lower(u.email) = lower(btrim(p_email))
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Session lookup (cookie -> user + active business)
-- ---------------------------------------------------------------------------

create or replace function app.auth_find_session(p_token_hash text)
returns table (
  session_id        uuid,
  user_id           uuid,
  email             text,
  full_name         text,
  user_is_active    boolean,
  session_expires_at timestamptz,
  session_revoked_at timestamptz,
  business_id       uuid,
  business_role     public.business_role,
  membership_status public.membership_status,
  legal_name        text,
  trading_name      text,
  currency_code     char(3)
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    s.id,
    u.id,
    u.email,
    u.full_name,
    u.is_active,
    s.expires_at,
    s.revoked_at,
    bu.business_id,
    bu.role,
    bu.status,
    b.legal_name,
    b.trading_name,
    b.currency_code
  from public.sessions s
  join public.users u on u.id = s.user_id
  left join lateral (
    select bu.business_id, bu.role, bu.status
    from public.business_users bu
    where bu.user_id = u.id and bu.status = 'ACTIVE'
    order by bu.created_at asc
    limit 1
  ) bu on true
  left join public.businesses b on b.id = bu.business_id
  where s.token_hash = p_token_hash
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Password reset
-- ---------------------------------------------------------------------------

create or replace function app.auth_create_reset(
  p_email      text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid;
begin
  select u.id into v_user_id
  from public.users u
  where lower(u.email) = lower(btrim(p_email)) and u.is_active
  limit 1;

  if v_user_id is null then
    -- Return false without disclosing whether the account exists.
    return false;
  end if;

  -- Invalidate outstanding tokens for this user before issuing a new one.
  update public.password_reset_tokens
     set used_at = now()
   where user_id = v_user_id and used_at is null;

  insert into public.password_reset_tokens (user_id, token_hash, expires_at)
  values (v_user_id, p_token_hash, p_expires_at);

  return true;
end;
$$;

create or replace function app.auth_consume_reset_and_set_password(
  p_token_hash    text,
  p_password_hash text
)
returns table (user_id uuid, email text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_token public.password_reset_tokens;
begin
  select * into v_token
  from public.password_reset_tokens t
  where t.token_hash = p_token_hash
    and t.used_at is null
    and t.expires_at > now()
  limit 1;

  if v_token.id is null then
    return; -- invalid, expired or already used: no rows, no state change
  end if;

  update public.password_reset_tokens
     set used_at = now()
   where id = v_token.id;

  update public.users
     set password_hash = p_password_hash,
         updated_at = now()
   where id = v_token.user_id;

  -- Any existing session becomes invalid once the password changes.
  update public.sessions
     set revoked_at = now()
   where sessions.user_id = v_token.user_id and revoked_at is null;

  return query
    select v_token.user_id, u.email from public.users u where u.id = v_token.user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Operator helper: grant the runtime role the exact privileges it needs.
-- Usage: select app.grant_app_role('cg_app');
-- ---------------------------------------------------------------------------

create or replace function app.grant_app_role(p_role text)
returns void
language plpgsql
as $$
begin
  if not exists (select 1 from pg_roles where rolname = p_role) then
    raise exception 'role % does not exist', p_role;
  end if;

  execute format('grant usage on schema public to %I', p_role);
  execute format('grant usage on schema app to %I', p_role);
  execute format('grant select, insert, update, delete on all tables in schema public to %I', p_role);
  execute format('grant select, insert, update, delete on all tables in schema public to %I', p_role);
  execute format('grant usage, select on all sequences in schema public to %I', p_role);
  execute format('grant execute on all functions in schema app to %I', p_role);

  -- The runtime role must never be able to re-grant privileges or fire trigger
  -- helpers directly.
  execute format('revoke all on function app.grant_app_role(text) from %I', p_role);
  execute format('revoke all on function app.set_updated_at() from %I', p_role);

  execute format(
    'alter default privileges in schema public grant select, insert, update, delete on tables to %I',
    p_role
  );
end;
$$;

-- Helper functions are not public API.
revoke all on function app.auth_find_user(text) from public;
revoke all on function app.auth_find_session(text) from public;
revoke all on function app.auth_create_reset(text, text, timestamptz) from public;
revoke all on function app.auth_consume_reset_and_set_password(text, text) from public;
revoke all on function app.grant_app_role(text) from public;

commit;
