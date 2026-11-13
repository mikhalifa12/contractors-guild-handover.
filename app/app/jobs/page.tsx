import type { Metadata } from 'next';
import Link from 'next/link';
import { StatusBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { EmptyState } from '@/components/ui/section';
import { FilterChips, ListSearch, Pagination } from '@/components/app/list-controls';
import { ClipboardIcon } from '@/components/icons';
import { requireSession } from '@/lib/auth/current-user';
import { getJobStatusCounts, listJobs } from '@/lib/repositories/jobs';
import { JOB_STATUSES, type JobStatus } from '@/lib/jobs';
import { formatDate, humaniseEnum } from '@/lib/format';

export const metadata: Metadata = { title: 'Jobs' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

type SearchParams = Promise<{
  q?: string;
  status?: string;
  customerId?: string;
  sort?: string;
  page?: string;
  missing?: string;
  statusUpdated?: string;
  statusError?: string;
}>;

function resolveStatus(value: string | undefined): JobStatus | 'ALL' | 'OPEN' {
  if (value === 'OPEN') return 'OPEN';
  if (value && (JOB_STATUSES as readonly string[]).includes(value)) return value as JobStatus;
  return 'ALL';
}

export default async function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const params = await searchParams;

  const search = params.q?.trim() || null;
  const status = resolveStatus(params.status);
  const sort = params.sort === 'scheduled' ? 'scheduled' : 'recent';
  const page = Math.max(Number(params.page ?? '1') || 1, 1);

  const [{ rows, total }, counts] = await Promise.all([
    listJobs(session.businessId, session.userId, {
      search,
      status,
      customerId: params.customerId ?? null,
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    getJobStatusCounts(session.businessId, session.userId),
  ]);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="cg-eyebrow">Jobs</p>
          <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">Jobs</h1>
          <p className="mt-1.5 text-sm text-steel-500">
            {counts.OPEN} open · {counts.COMPLETED} completed
            {counts.CANCELLED > 0 ? ` · ${counts.CANCELLED} cancelled` : ''}
          </p>
        </div>
        <ButtonLink href="/app/jobs/new" size="md">
          New job
        </ButtonLink>
      </header>

      {params.statusUpdated ? (
        <Alert tone="info" title="Status updated">
          <p>The job is now {humaniseEnum(params.statusUpdated)}.</p>
        </Alert>
      ) : null}
      {params.statusError ? (
        <Alert tone="danger" title="Status not changed">
          <p>
            {params.statusError === 'not_allowed'
              ? 'That move is not allowed from the job’s current status. Refresh the page to see the available steps.'
              : 'We could not update the job status. Please try again.'}
          </p>
        </Alert>
      ) : null}
      {params.missing ? (
        <Alert tone="warning" title="Job not found">
          <p>That job is not in your business (it may have been removed, or the link was wrong).</p>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <ListSearch placeholder="Search job number, title or customer…" label="Search jobs" />
          <FilterChips
            paramName="sort"
            active={sort}
            basePath="/app/jobs"
            preserve={['q', 'status']}
            chips={[
              { value: 'recent', label: 'Newest first' },
              { value: 'scheduled', label: 'By schedule date' },
            ]}
          />
        </div>

        <FilterChips
          paramName="status"
          active={status}
          basePath="/app/jobs"
          preserve={['q', 'sort']}
          chips={[
            { value: 'ALL', label: 'All', count: counts.ALL },
            { value: 'OPEN', label: 'Open', count: counts.OPEN },
            ...JOB_STATUSES.map((value) => ({
              value,
              label: humaniseEnum(value),
              count: counts[value],
            })),
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardIcon className="h-8 w-8" />}
          title={search || status !== 'ALL' ? 'No jobs match that' : 'No jobs yet'}
          description={
            search || status !== 'ALL'
              ? 'Try another search or switch back to All.'
              : 'A job is the work itself: fault finding, an installation, a compliance inspection. Quotes, invoices and payments attach to it, so everything for one site stays together.'
          }
          action={
            search || status !== 'ALL' ? null : <ButtonLink href="/app/jobs/new">Create a job</ButtonLink>
          }
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((job) => (
            <li key={job.id} className="cg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-steel-500">{job.job_number}</span>
                    <StatusBadge status={job.status} />
                  </div>
                  <Link
                    href={`/app/jobs/${job.id}`}
                    className="mt-1 block text-base font-semibold text-paper hover:text-ember-300"
                  >
                    {job.title}
                  </Link>
                  <p className="mt-0.5 text-sm text-steel-400">
                    <Link
                      href={`/app/customers/${job.customer_id}`}
                      className="hover:text-paper"
                    >
                      {job.customer_name}
                    </Link>
                    {job.job_type ? ` · ${job.job_type}` : ''}
                    {job.job_city ? ` · ${job.job_city}` : ''}
                  </p>
                </div>

                <div className="text-right text-xs text-steel-500">
                  <p>
                    {job.scheduled_date
                      ? `Scheduled ${formatDate(job.scheduled_date)}`
                      : 'Not scheduled'}
                  </p>
                  {job.completed_date ? <p>Completed {formatDate(job.completed_date)}</p> : null}
                  <p className="mt-1">
                    {job.quote_count} quotes · {job.invoice_count} invoices
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        basePath="/app/jobs"
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        searchParams={{
          q: search ?? undefined,
          status,
          sort,
          customerId: params.customerId,
        }}
      />
    </>
  );
}
