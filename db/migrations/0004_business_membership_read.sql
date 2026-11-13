-- ============================================================================
-- Contractors Guild - Migration 0004: membership-scoped business reads
--
-- Why this exists
--   Sign-in and workspace switching need to list the businesses a user belongs
--   to BEFORE a business has been selected for the session (app.business_id is
--   not set yet). The original policy required the id to equal the active
--   business, which made that impossible without bypassing RLS.
--
-- What changed
--   Reading a business row now requires an ACTIVE membership for the current
--   user (app.is_member_of), not the active-business match. This exposes
--   nothing new: a user may only ever read businesses they belong to.
--
--   Writes stay strict: businesses_update still requires BOTH the active
--   business match and an active membership, so a session can only ever modify
--   the workspace it is currently operating in.
--
-- Tenant DATA tables (customers, jobs, quotes, invoices, payments, ...) keep
-- the strict `business_id = app.current_business_id() and app.is_member_of(...)`
-- rule from migration 0002.
-- ============================================================================

begin;

drop policy if exists businesses_select on public.businesses;

create policy businesses_select on public.businesses
  for select to public
  using (app.is_member_of(id));

commit;
