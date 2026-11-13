-- ============================================================================
-- Contractors Guild - Migration 0005: anonymous authentication audit events
--
-- Why this exists
--   A failed sign-in attempt has no authenticated user and no selected
--   business, but it must still be recorded (brute-force detection, support
--   investigations). The previous audit_events insert policy required
--   user_id = app.current_user_id(), which is never true when both are null,
--   so recording a failed login was rejected by RLS.
--
-- What changed
--   The insert policy gains one narrow branch: anonymous rows are allowed only
--   when they are authentication events (event_type like 'auth.%') with no
--   business and no user attached. Business-scoped events keep the original
--   rule.
--
--   These anonymous rows are append-only and are not readable through the
--   application role (the select policy still requires a matching active
--   membership), so they cannot leak to contractors.
-- ============================================================================

begin;

drop policy if exists audit_events_insert on public.audit_events;

create policy audit_events_insert on public.audit_events
  for insert to public
  with check (
    (business_id = app.current_business_id() and app.is_member_of(business_id))
    or (business_id is null and user_id = app.current_user_id())
    or (
      business_id is null
      and user_id is null
      and event_type like 'auth.%'
    )
  );

commit;
