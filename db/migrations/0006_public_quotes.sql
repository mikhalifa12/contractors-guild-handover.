-- ============================================================================
-- Contractors Guild - Migration 0006: public quote links
--
-- Why this exists
--   Phase 3 lets a customer open a quote at /q/<token> and accept or decline
--   it. That visitor has no account and no session, so the tenant policies in
--   0002 cannot be used for the read: the quote has to be reachable through a
--   narrow, SECURITY DEFINER function that is keyed by the unguessable token
--   and returns exactly one document.
--
-- What this migration adds
--   1. A DELETE policy for quote_items, limited to lines of a DRAFT quote.
--      Editing a draft (add a line, remove a line, fix a price) has to replace
--      the line set, and 0002 deliberately grants no delete on tenant tables.
--      Once a quote is sent it is a document that was shown to a customer, so
--      its lines become immutable and this policy stops applying.
--   2. app.public_quote(token)          - read one quote by its public token
--   3. app.public_quote_mark_viewed()   - first view stamps viewed_at and moves
--                                         SENT -> VIEWED, exactly once
--   4. app.public_quote_respond()       - accept or decline, with the guards
--                                         that matter: the quote must still be
--                                         open, must not be past its validity
--                                         date, and acceptance records who
--                                         accepted, when and from which IP.
--
-- Design notes
--   - The public functions return JSON built from an explicit column list, so
--     a column added later is not exposed by accident, and they never return
--     internal identifiers (business_id, customer_id, created_by) or the
--     token itself.
--   - They are SECURITY DEFINER with a pinned search_path and revoked from
--     PUBLIC; the application role is granted EXECUTE by app.grant_app_role()
--     which scripts/lib/postgres.mjs runs after every migration.
--   - Acceptance is idempotent in the only safe direction: a quote that is no
--     longer SENT/VIEWED is refused, so the first acceptance (and therefore the
--     timestamp, name and IP) is the one that stands.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Draft quote lines may be replaced, sent ones may not
-- ---------------------------------------------------------------------------

drop policy if exists quote_items_delete on public.quote_items;

create policy quote_items_delete on public.quote_items
  for delete to public
  using (
    business_id = app.current_business_id()
    and app.is_member_of(business_id)
    and exists (
      select 1
        from public.quotes q
       where q.id = quote_items.quote_id
         and q.business_id = app.current_business_id()
         and q.status = 'DRAFT'
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Read one quote by its public token
-- ---------------------------------------------------------------------------

create or replace function app.public_quote(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'quote', jsonb_build_object(
      'quote_number', q.quote_number,
      'status', q.status,
      'issue_date', q.issue_date,
      'valid_until', q.valid_until,
      'job_type', q.job_type,
      'description', q.description,
      'contact_person', q.contact_person,
      'contact_phone', q.contact_phone,
      'contact_email', q.contact_email,
      'job_address_line1', q.job_address_line1,
      'job_address_line2', q.job_address_line2,
      'job_city', q.job_city,
      'job_province', q.job_province,
      'job_postal_code', q.job_postal_code,
      'subtotal', q.subtotal,
      'discount_total', q.discount_total,
      'tax_total', q.tax_total,
      'total', q.total,
      'payment_terms', q.payment_terms,
      'notes', q.notes,
      'terms_and_conditions', q.terms_and_conditions,
      'sent_at', q.sent_at,
      'viewed_at', q.viewed_at,
      'accepted_at', q.accepted_at,
      'accepted_by_name', q.accepted_by_name,
      'declined_at', q.declined_at,
      'declined_reason', q.declined_reason
    ),
    'business', jsonb_build_object(
      'legal_name', b.legal_name,
      'trading_name', b.trading_name,
      'registration_number', b.registration_number,
      'tax_number', b.tax_number,
      'address_line1', b.address_line1,
      'address_line2', b.address_line2,
      'city', b.city,
      'province', b.province,
      'postal_code', b.postal_code,
      'country', b.country,
      'phone', b.phone,
      'email', b.email,
      'website', b.website,
      'currency_code', b.currency_code,
      'has_logo', b.logo_storage_key is not null
    ),
    'customer', jsonb_build_object(
      'business_name', c.business_name,
      'contact_person', c.contact_person
    ),
    'items', coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'line_number', qi.line_number,
                   'description', qi.description,
                   'quantity', qi.quantity,
                   'unit', qi.unit,
                   'unit_price', qi.unit_price,
                   'discount_percent', qi.discount_percent,
                   'tax_rate', qi.tax_rate,
                   'line_subtotal', qi.line_subtotal,
                   'line_discount', qi.line_discount,
                   'line_tax', qi.line_tax,
                   'line_total', qi.line_total
                 )
                 order by qi.line_number
               )
          from public.quote_items qi
         where qi.quote_id = q.id
      ),
      '[]'::jsonb
    )
  )
    from public.quotes q
    join public.businesses b on b.id = q.business_id
    join public.customers c on c.id = q.customer_id
   where q.public_token = p_token
     and q.public_token is not null
     and p_token is not null
     and length(p_token) >= 16;
$$;

-- ---------------------------------------------------------------------------
-- 3. First customer view
-- ---------------------------------------------------------------------------

create or replace function app.public_quote_mark_viewed(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id          uuid;
  v_business_id uuid;
  v_status      public.quote_status;
  v_number      text;
begin
  select q.id, q.business_id, q.status, q.quote_number
    into v_id, v_business_id, v_status, v_number
    from public.quotes q
   where q.public_token = p_token
     and q.public_token is not null
     and length(p_token) >= 16
     for update;

  if v_id is null or v_status not in ('SENT', 'VIEWED') then
    return false;
  end if;

  update public.quotes
     set viewed_at = coalesce(viewed_at, now()),
         status = case when status = 'SENT' then 'VIEWED'::public.quote_status else status end
   where id = v_id;

  -- Record the first view only, so the trail says when the customer opened it
  -- rather than how many times the page was reloaded.
  if v_status = 'SENT' then
    insert into public.audit_events (business_id, user_id, event_type, entity_type, entity_id, metadata)
    values (
      v_business_id,
      null,
      'quote.viewed',
      'quote',
      v_id,
      jsonb_build_object('quote_number', v_number, 'by', 'customer')
    );
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Accept or decline from the public page
-- ---------------------------------------------------------------------------

create or replace function app.public_quote_respond(
  p_token      text,
  p_decision   text,
  p_name       text,
  p_reason     text,
  p_ip         inet,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id          uuid;
  v_business_id uuid;
  v_status      public.quote_status;
  v_valid_until date;
  v_number      text;
  v_decision    text := upper(btrim(coalesce(p_decision, '')));
  v_name        text := nullif(btrim(coalesce(p_name, '')), '');
  v_reason      text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_decision not in ('ACCEPT', 'DECLINE') then
    return jsonb_build_object('ok', false, 'code', 'invalid_decision');
  end if;

  select q.id, q.business_id, q.status, q.valid_until, q.quote_number
    into v_id, v_business_id, v_status, v_valid_until, v_number
    from public.quotes q
   where q.public_token = p_token
     and q.public_token is not null
     and length(p_token) >= 16
     for update;

  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_status not in ('SENT', 'VIEWED') then
    return jsonb_build_object('ok', false, 'code', 'not_open', 'status', v_status);
  end if;

  -- A quote that ran out of time cannot be accepted; record the expiry so the
  -- contractor's list agrees with what the customer saw.
  if v_valid_until is not null and v_valid_until < current_date then
    update public.quotes set status = 'EXPIRED'::public.quote_status where id = v_id;

    insert into public.audit_events (business_id, user_id, event_type, entity_type, entity_id, metadata)
    values (
      v_business_id,
      null,
      'quote.expired',
      'quote',
      v_id,
      jsonb_build_object('quote_number', v_number, 'valid_until', v_valid_until)
    );

    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;

  if v_decision = 'ACCEPT' then
    if v_name is null or length(v_name) > 120 then
      return jsonb_build_object('ok', false, 'code', 'name_required');
    end if;

    update public.quotes
       set status = 'ACCEPTED'::public.quote_status,
           accepted_at = now(),
           accepted_by_name = v_name,
           accepted_ip = p_ip
     where id = v_id;

    insert into public.audit_events (business_id, user_id, event_type, entity_type, entity_id, metadata, ip_address)
    values (
      v_business_id,
      null,
      'quote.accepted',
      'quote',
      v_id,
      jsonb_build_object(
        'quote_number', v_number,
        'accepted_by', v_name,
        'user_agent', left(coalesce(p_user_agent, ''), 300)
      ),
      p_ip
    );

    return jsonb_build_object('ok', true, 'code', 'accepted', 'accepted_by_name', v_name);
  end if;

  update public.quotes
     set status = 'DECLINED'::public.quote_status,
         declined_at = now(),
         declined_reason = left(v_reason, 400)
   where id = v_id;

  insert into public.audit_events (business_id, user_id, event_type, entity_type, entity_id, metadata, ip_address)
  values (
    v_business_id,
    null,
    'quote.declined',
    'quote',
    v_id,
    jsonb_build_object(
      'quote_number', v_number,
      'reason', left(coalesce(v_reason, ''), 400),
      'user_agent', left(coalesce(p_user_agent, ''), 300)
    ),
    p_ip
  );

  return jsonb_build_object('ok', true, 'code', 'declined');
end;
$$;

-- Public endpoints are still not public API: only the application role may
-- call them, and only with a token it already holds.
revoke all on function app.public_quote(text) from public;
revoke all on function app.public_quote_mark_viewed(text) from public;
revoke all on function app.public_quote_respond(text, text, text, text, inet, text) from public;

commit;
