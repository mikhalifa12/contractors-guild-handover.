-- ============================================================================
-- Contractors Guild - Migration 0008: draft invoice lines
--
-- Why this exists
--   Phase 4 lets a contractor edit a DRAFT invoice's lines (add, remove, fix a
--   price). Replacing the line set needs DELETE on invoice_items, and 0002
--   deliberately grants no delete on tenant tables. A sent invoice is a
--   document the customer owes against, so its lines must be immutable: the
--   policy below stops applying the moment the invoice leaves DRAFT, exactly
--   like the quote_items policy added in 0006.
--
-- No table, column or constraint is changed or removed.
-- ============================================================================

begin;

drop policy if exists invoice_items_delete on public.invoice_items;

create policy invoice_items_delete on public.invoice_items
  for delete to public
  using (
    business_id = app.current_business_id()
    and app.is_member_of(business_id)
    and exists (
      select 1
        from public.invoices i
       where i.id = invoice_items.invoice_id
         and i.business_id = app.current_business_id()
         and i.status = 'DRAFT'
    )
  );

commit;
