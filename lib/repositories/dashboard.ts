import { withContext } from '@/lib/db';

/**
 * Dashboard aggregates.
 *
 * These are real SQL aggregates over the tenant's own rows (RLS enforced), so
 * the numbers are correct the moment Phases 2-5 start writing data. Nothing
 * here is mocked or estimated.
 */
export type DashboardSummary = {
  customer_count: number;
  active_job_count: number;
  quote_count: number;
  quotes_awaiting_acceptance: number;
  awaiting_acceptance_value: string;
  invoice_count: number;
  unpaid_invoice_count: number;
  outstanding_value: string;
  overdue_invoice_count: number;
  overdue_value: string;
  revenue_total: string;
  revenue_this_month: string;
  payment_count: number;
};

const EMPTY_SUMMARY: DashboardSummary = {
  customer_count: 0,
  active_job_count: 0,
  quote_count: 0,
  quotes_awaiting_acceptance: 0,
  awaiting_acceptance_value: '0',
  invoice_count: 0,
  unpaid_invoice_count: 0,
  outstanding_value: '0',
  overdue_invoice_count: 0,
  overdue_value: '0',
  revenue_total: '0',
  revenue_this_month: '0',
  payment_count: 0,
};

export async function getDashboardSummary(
  businessId: string,
  userId: string
): Promise<DashboardSummary> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<DashboardSummary>(
      `select
         (select count(*) from customers where is_active)                        as customer_count,
         (select count(*) from jobs
           where status in ('APPROVED','SCHEDULED','IN_PROGRESS'))               as active_job_count,
         (select count(*) from quotes)                                           as quote_count,
         (select count(*) from quotes where status in ('SENT','VIEWED'))          as quotes_awaiting_acceptance,
         (select coalesce(sum(total), 0) from quotes
           where status in ('SENT','VIEWED'))                                    as awaiting_acceptance_value,
         (select count(*) from invoices where status <> 'CANCELLED')              as invoice_count,
         (select count(*) from invoices
           where status in ('SENT','VIEWED','PARTIALLY_PAID','OVERDUE'))          as unpaid_invoice_count,
         (select coalesce(sum(total - amount_paid), 0) from invoices
           where status in ('SENT','VIEWED','PARTIALLY_PAID','OVERDUE'))          as outstanding_value,
         (select count(*) from invoices
           where status = 'OVERDUE'
              or (status in ('SENT','VIEWED','PARTIALLY_PAID')
                  and due_date is not null and due_date < current_date))          as overdue_invoice_count,
         (select coalesce(sum(total - amount_paid), 0) from invoices
           where status = 'OVERDUE'
              or (status in ('SENT','VIEWED','PARTIALLY_PAID')
                  and due_date is not null and due_date < current_date))          as overdue_value,
         (select coalesce(sum(amount), 0) from payments)                          as revenue_total,
         (select coalesce(sum(amount), 0) from payments
           where payment_date >= date_trunc('month', current_date))               as revenue_this_month,
         (select count(*) from payments)                                          as payment_count`,
      []
    );

    return rows[0] ?? EMPTY_SUMMARY;
  });
}

export type RecentActivity = {
  kind: 'quote' | 'invoice' | 'payment' | 'customer';
  id: string;
  reference: string;
  description: string;
  status: string | null;
  amount: string | null;
  created_at: string;
};

export async function getRecentActivity(
  businessId: string,
  userId: string,
  limit = 8
): Promise<RecentActivity[]> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<RecentActivity>(
      `select * from (
         select 'quote' as kind, q.id, q.quote_number as reference,
                coalesce(c.business_name, 'Customer') as description,
                q.status::text as status, q.total::text as amount, q.created_at
           from quotes q
           join customers c on c.id = q.customer_id
         union all
         select 'invoice' as kind, i.id, i.invoice_number as reference,
                coalesce(c.business_name, 'Customer') as description,
                i.status::text as status, i.total::text as amount, i.created_at
           from invoices i
           join customers c on c.id = i.customer_id
         union all
         select 'payment' as kind, p.id, coalesce(p.reference, 'Payment') as reference,
                coalesce(c.business_name, 'Customer') as description,
                p.method::text as status, p.amount::text as amount, p.created_at
           from payments p
           join customers c on c.id = p.customer_id
         union all
         select 'customer' as kind, c.id, c.business_name as reference,
                coalesce(c.contact_person, 'New customer') as description,
                null as status, null as amount, c.created_at
           from customers c
       ) activity
       order by created_at desc
       limit $1`,
      [limit]
    );

    return rows;
  });
}
