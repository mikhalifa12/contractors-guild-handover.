-- ============================================================================
-- Contractors Guild - Migration 0007: the customer's copy of a quote
--
-- Why this exists
--   The public quote page and the public PDF need two things that 0006 did not
--   return: the customer's billing address (so the "prepared for" block on the
--   document is complete) and the business's logo storage key (so the customer
--   sees the same branded document the contractor downloads).
--
-- What this changes
--   - app.public_quote(token) is redefined with the customer's postal address.
--     It still returns one document, still omits internal identifiers, and
--     still never returns the token itself.
--   - app.public_quote_logo_key(token) returns the storage key for the
--     business's logo, and nothing else. A storage key is an internal path, not
--     a permission: holding the quote token already shows the whole document,
--     and the key is only ever used to read that one business's logo.
--
--   Both are SECURITY DEFINER with a pinned search_path, revoked from PUBLIC,
--   and granted to the application role by app.grant_app_role() (which
--   scripts/lib/postgres.mjs runs after every migration).
-- ============================================================================

begin;

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
      'contact_person', c.contact_person,
      'billing_address_line1', c.billing_address_line1,
      'billing_address_line2', c.billing_address_line2,
      'billing_city', c.billing_city,
      'billing_province', c.billing_province,
      'billing_postal_code', c.billing_postal_code
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

create or replace function app.public_quote_logo_key(p_token text)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select b.logo_storage_key
    from public.quotes q
    join public.businesses b on b.id = q.business_id
   where q.public_token = p_token
     and q.public_token is not null
     and p_token is not null
     and length(p_token) >= 16
   limit 1;
$$;

revoke all on function app.public_quote(text) from public;
revoke all on function app.public_quote_logo_key(text) from public;

commit;
