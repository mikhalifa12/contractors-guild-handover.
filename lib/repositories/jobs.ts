import { withContext } from '@/lib/db';
import { allocateDocumentNumber } from '@/lib/numbering';
import type { JobStatus } from '@/lib/jobs';
import { recordAuditEvent } from '@/lib/repositories/audit';

/**
 * Jobs.
 *
 * Job numbers are allocated inside the same transaction as the insert, using
 * the row-locked `document_sequences` upsert, so two contractors (or the same
 * contractor on two devices) can never receive the same number.
 */
export type JobRow = {
  id: string;
  customer_id: string;
  job_number: string;
  title: string;
  description: string | null;
  job_type: string | null;
  job_address_line1: string | null;
  job_address_line2: string | null;
  job_city: string | null;
  job_province: string | null;
  job_postal_code: string | null;
  scheduled_date: string | null;
  completed_date: string | null;
  status: JobStatus;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
};

export type JobListItem = JobRow & {
  customer_name: string;
  customer_type: 'BUSINESS' | 'INDIVIDUAL';
  quote_count: number;
  invoice_count: number;
};

export type JobDetail = JobListItem & {
  customer_contact_person: string | null;
  customer_phone: string | null;
  customer_email: string | null;
};

export type JobListFilters = {
  search?: string | null;
  status?: JobStatus | 'ALL' | 'OPEN';
  customerId?: string | null;
  sort?: 'recent' | 'scheduled';
  limit?: number;
  offset?: number;
};

export type JobInput = {
  customerId: string;
  title: string;
  description: string | null;
  jobType: string | null;
  status: JobStatus;
  scheduledDate: string | null;
  jobAddressLine1: string | null;
  jobAddressLine2: string | null;
  jobCity: string | null;
  jobProvince: string | null;
  jobPostalCode: string | null;
  notes: string | null;
};

const JOB_COLUMNS = `j.id, j.customer_id, j.job_number, j.title, j.description, j.job_type,
  j.job_address_line1, j.job_address_line2, j.job_city, j.job_province, j.job_postal_code,
  j.scheduled_date, j.completed_date, j.status, j.notes, j.created_at, j.updated_at`;

export async function listJobs(
  businessId: string,
  userId: string,
  filters: JobListFilters = {}
): Promise<{ rows: JobListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  const search = filters.search?.trim() ? `%${filters.search.trim()}%` : null;
  const status = filters.status && filters.status !== 'ALL' && filters.status !== 'OPEN'
    ? filters.status
    : null;
  const openOnly = filters.status === 'OPEN';

  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<JobListItem & { total_count: string }>(
      `select ${JOB_COLUMNS}, c.business_name as customer_name, c.customer_type,
              coalesce(q.quote_count, 0)::int as quote_count,
              coalesce(i.invoice_count, 0)::int as invoice_count,
              count(*) over() as total_count
         from jobs j
         join customers c on c.id = j.customer_id
         left join lateral (
           select count(*) as quote_count from quotes q where q.job_id = j.id
         ) q on true
         left join lateral (
           select count(*) as invoice_count from invoices v where v.job_id = j.id
         ) i on true
        where j.business_id = $1
          and ($2::job_status is null or j.status = $2)
          and (not $3::boolean or j.status not in ('COMPLETED', 'CANCELLED'))
          and ($4::uuid is null or j.customer_id = $4)
          and ($5::text is null
               or j.title ilike $5
               or j.job_number ilike $5
               or coalesce(j.description, '') ilike $5
               or coalesce(j.job_type, '') ilike $5
               or c.business_name ilike $5)
        order by ${
          filters.sort === 'scheduled'
            ? 'j.scheduled_date asc nulls last, j.created_at desc'
            : 'j.created_at desc'
        }
        limit $6 offset $7`,
      [businessId, status, openOnly, filters.customerId ?? null, search, limit, offset]
    );

    const total = rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0;
    return { rows, total };
  });
}

export async function getJob(
  businessId: string,
  userId: string,
  jobId: string
): Promise<JobDetail | null> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<JobDetail>(
      `select ${JOB_COLUMNS}, c.business_name as customer_name, c.customer_type,
              c.contact_person as customer_contact_person,
              c.phone as customer_phone,
              c.email as customer_email,
              coalesce(q.quote_count, 0)::int as quote_count,
              coalesce(i.invoice_count, 0)::int as invoice_count
         from jobs j
         join customers c on c.id = j.customer_id
         left join lateral (
           select count(*) as quote_count from quotes q where q.job_id = j.id
         ) q on true
         left join lateral (
           select count(*) as invoice_count from invoices v where v.job_id = j.id
         ) i on true
        where j.id = $1 and j.business_id = $2`,
      [jobId, businessId]
    );
    return rows[0] ?? null;
  });
}

export type JobStatusCounts = Record<JobStatus | 'OPEN' | 'ALL', number>;

export async function getJobStatusCounts(
  businessId: string,
  userId: string
): Promise<JobStatusCounts> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<{ status: JobStatus; count: string }>(
      `select status, count(*) as count from jobs where business_id = $1 group by status`,
      [businessId]
    );

    const counts: JobStatusCounts = {
      ALL: 0,
      OPEN: 0,
      LEAD: 0,
      QUOTED: 0,
      APPROVED: 0,
      SCHEDULED: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    };

    for (const row of rows) {
      const value = Number(row.count);
      counts[row.status] = value;
      counts.ALL += value;
      if (row.status !== 'COMPLETED' && row.status !== 'CANCELLED') counts.OPEN += value;
    }

    return counts;
  });
}

export async function createJob(
  businessId: string,
  userId: string,
  input: JobInput,
  meta: { ipAddress?: string | null } = {}
): Promise<{ id: string; jobNumber: string }> {
  return withContext({ userId, businessId }, async (client) => {
    // Default the site address to the customer's site address so a contractor
    // does not have to type it again on a phone.
    let address = {
      line1: input.jobAddressLine1,
      line2: input.jobAddressLine2,
      city: input.jobCity,
      province: input.jobProvince,
      postalCode: input.jobPostalCode,
    };

    const usesCustomerAddress =
      !address.line1 && !address.line2 && !address.city && !address.province && !address.postalCode;

    if (usesCustomerAddress) {
      const { rows } = await client.query<{
        site_address_line1: string | null;
        site_address_line2: string | null;
        site_city: string | null;
        site_province: string | null;
        site_postal_code: string | null;
      }>(
        `select site_address_line1, site_address_line2, site_city, site_province, site_postal_code
           from customers where id = $1 and business_id = $2`,
        [input.customerId, businessId]
      );

      const site = rows[0];
      if (site) {
        address = {
          line1: site.site_address_line1,
          line2: site.site_address_line2,
          city: site.site_city,
          province: site.site_province,
          postalCode: site.site_postal_code,
        };
      }
    }

    const jobNumber = await allocateDocumentNumber(client, businessId, 'JOB');

    const { rows } = await client.query<{ id: string }>(
      `insert into jobs
         (business_id, customer_id, job_number, title, description, job_type, status,
          scheduled_date, completed_date, job_address_line1, job_address_line2, job_city,
          job_province, job_postal_code, notes, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       returning id`,
      [
        businessId,
        input.customerId,
        jobNumber,
        input.title,
        input.description,
        input.jobType,
        input.status,
        input.scheduledDate,
        input.status === 'COMPLETED' ? new Date().toISOString().slice(0, 10) : null,
        address.line1,
        address.line2,
        address.city,
        address.province,
        address.postalCode,
        input.notes,
        userId,
      ]
    );

    const id = rows[0]?.id;
    if (!id) throw new Error('Job insert returned no row');

    await recordAuditEvent(client, {
      businessId,
      userId,
      eventType: 'job.created',
      entityType: 'job',
      entityId: id,
      metadata: { jobNumber, title: input.title, status: input.status },
      ipAddress: meta.ipAddress ?? null,
    });

    return { id, jobNumber };
  });
}

export async function updateJob(
  businessId: string,
  userId: string,
  jobId: string,
  input: JobInput,
  meta: { ipAddress?: string | null } = {}
): Promise<{ updated: boolean }> {
  return withContext({ userId, businessId }, async (client) => {
    const { rowCount } = await client.query(
      `update jobs
          set customer_id = $3, title = $4, description = $5, job_type = $6,
              scheduled_date = $7, job_address_line1 = $8, job_address_line2 = $9,
              job_city = $10, job_province = $11, job_postal_code = $12, notes = $13
        where id = $1 and business_id = $2`,
      [
        jobId,
        businessId,
        input.customerId,
        input.title,
        input.description,
        input.jobType,
        input.scheduledDate,
        input.jobAddressLine1,
        input.jobAddressLine2,
        input.jobCity,
        input.jobProvince,
        input.jobPostalCode,
        input.notes,
      ]
    );

    if (!rowCount) return { updated: false };

    await recordAuditEvent(client, {
      businessId,
      userId,
      eventType: 'job.updated',
      entityType: 'job',
      entityId: jobId,
      metadata: { title: input.title },
      ipAddress: meta.ipAddress ?? null,
    });

    return { updated: true };
  });
}

export async function countJobs(
  businessId: string,
  userId: string
): Promise<{ total: number; open: number; completed: number }> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<{ total: string; open: string; completed: string }>(
      `select count(*) as total,
              count(*) filter (where status not in ('COMPLETED', 'CANCELLED')) as open,
              count(*) filter (where status = 'COMPLETED') as completed
         from jobs where business_id = $1`,
      [businessId]
    );
    return {
      total: Number(rows[0]?.total ?? 0),
      open: Number(rows[0]?.open ?? 0),
      completed: Number(rows[0]?.completed ?? 0),
    };
  });
}
