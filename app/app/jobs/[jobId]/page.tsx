import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { JobStatusActions } from '@/components/app/job-status-actions';
import { WhatsAppIcon } from '@/components/icons';
import { requireSession } from '@/lib/auth/current-user';
import { getJob } from '@/lib/repositories/jobs';
import { listQuotesForJob } from '@/lib/repositories/quotes';
import { listEntityActivity } from '@/lib/repositories/audit';
import { JOB_STATUS_FLOW, type JobStatus } from '@/lib/jobs';
import { effectiveQuoteStatus } from '@/lib/quotes';
import { formatCurrency } from '@/lib/money';
import { formatDate, formatDateTime, humaniseEnum } from '@/lib/format';
import { buildWhatsAppLink } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ jobId: string }>;
}): Promise<Metadata> {
  const { jobId } = await params;
  const session = await requireSession();
  const job = await getJob(session.businessId, session.userId, jobId);
  return { title: job ? `${job.job_number} · ${job.title}` : 'Job' };
}

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ saved?: string; statusUpdated?: string; statusError?: string }>;
}) {
  const session = await requireSession();
  const { jobId } = await params;
  const flags = await searchParams;

  const job = await getJob(session.businessId, session.userId, jobId);
  if (!job) notFound();

  const [activity, quotes] = await Promise.all([
    listEntityActivity(session.businessId, session.userId, 'job', job.id),
    listQuotesForJob(session.businessId, session.userId, job.id),
  ]);

  const siteLines = [
    job.job_address_line1,
    job.job_address_line2,
    [job.job_city, job.job_province].filter(Boolean).join(', ') || null,
    job.job_postal_code,
  ].filter((line): line is string => Boolean(line && line.trim()));

  const whatsapp = job.customer_phone
    ? buildWhatsAppLink(
        job.customer_phone,
        `Hi ${job.customer_contact_person ?? job.customer_name}, regarding ${job.job_number} (${job.title}): `
      )
    : null;

  const stepIndex = JOB_STATUS_FLOW.indexOf(job.status as JobStatus);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/app/jobs" className="cg-eyebrow hover:text-paper">
            ← Jobs
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-steel-500">{job.job_number}</span>
            <StatusBadge status={job.status} />
          </div>
          <h1 className="cg-display mt-1 break-words text-2xl text-paper sm:text-3xl">{job.title}</h1>
          <p className="mt-1.5 text-sm text-steel-400">
            <Link href={`/app/customers/${job.customer_id}`} className="hover:text-paper">
              {job.customer_name}
            </Link>
            {job.job_type ? ` · ${job.job_type}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/app/jobs/${job.id}/edit`} variant="secondary" size="md">
            Edit job
          </ButtonLink>
        </div>
      </header>

      {flags.saved ? (
        <Alert tone="info" title="Saved">
          <p>Job details updated.</p>
        </Alert>
      ) : null}
      {flags.statusUpdated ? (
        <Alert tone="info" title="Status updated">
          <p>The job is now {humaniseEnum(flags.statusUpdated)}.</p>
        </Alert>
      ) : null}
      {flags.statusError ? (
        <Alert tone="danger" title="Status not changed">
          <p>
            {flags.statusError === 'not_allowed'
              ? 'That move is not allowed from the current status — a job cannot skip pipeline steps.'
              : 'We could not update the job status. Please try again.'}
          </p>
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Next step"
          description="Only valid pipeline moves are offered, and each one is recorded in the job history"
        />
        <CardBody className="space-y-4">
          {job.status !== 'CANCELLED' ? (
            <ol className="flex flex-wrap gap-x-2 gap-y-1 text-xs uppercase tracking-wide">
              {JOB_STATUS_FLOW.map((step, index) => (
                <li
                  key={step}
                  className={
                    index < stepIndex
                      ? 'text-steel-500'
                      : index === stepIndex
                        ? 'font-bold text-ember-300'
                        : 'text-steel-600'
                  }
                >
                  {humaniseEnum(step)}
                  {index < JOB_STATUS_FLOW.length - 1 ? <span className="px-1">→</span> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-signal-danger">
              This job was cancelled. Reopening it returns it to Lead.
            </p>
          )}

          <JobStatusActions jobId={job.id} status={job.status} />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Customer" description="Who the work is for" />
          <CardBody className="space-y-3 text-sm">
            <p className="text-paper">
              <Link href={`/app/customers/${job.customer_id}`} className="hover:text-ember-300">
                {job.customer_name}
              </Link>
            </p>
            {job.customer_contact_person ? (
              <p className="text-steel-400">Contact: {job.customer_contact_person}</p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {job.customer_phone ? (
                <a
                  href={`tel:${job.customer_phone.replace(/\s/g, '')}`}
                  className="inline-flex min-h-11 items-center rounded-md border border-ink-600 px-4 text-sm font-semibold text-steel-300 hover:border-ember-500 hover:text-paper"
                >
                  {job.customer_phone}
                </a>
              ) : null}
              {whatsapp ? (
                <a
                  href={whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-ink-600 px-4 text-sm font-semibold text-steel-300 hover:border-ember-500 hover:text-paper"
                >
                  <WhatsAppIcon className="h-4 w-4" />
                  WhatsApp
                </a>
              ) : null}
              {job.customer_email ? (
                <a
                  href={`mailto:${job.customer_email}`}
                  className="inline-flex min-h-11 items-center rounded-md border border-ink-600 px-4 text-sm font-semibold text-steel-300 hover:border-ember-500 hover:text-paper"
                >
                  Email
                </a>
              ) : null}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Site & schedule" description="Where and when the work happens" />
          <CardBody className="space-y-3 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-steel-500">
                  Scheduled
                </p>
                <p className="mt-1 text-steel-300">
                  {job.scheduled_date ? formatDate(job.scheduled_date) : 'Not scheduled'}
                </p>
              </div>
              <div>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-steel-500">
                  Completed
                </p>
                <p className="mt-1 text-steel-300">
                  {job.completed_date ? formatDate(job.completed_date) : 'In progress or pending'}
                </p>
              </div>
            </div>

            <div>
              <p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-steel-500">
                Site address
              </p>
              {siteLines.length === 0 ? (
                <p className="mt-1 text-steel-500">Same as the customer&apos;s address</p>
              ) : (
                <address className="mt-1 not-italic text-steel-300">
                  {siteLines.map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </address>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      {job.description || job.notes ? (
        <Card>
          <CardHeader title="Details" description="What needs doing, and anything else worth knowing" />
          <CardBody className="space-y-4 text-sm">
            {job.description ? (
              <div>
                <p className="cg-eyebrow">Description</p>
                <p className="mt-1 whitespace-pre-line text-steel-300">{job.description}</p>
              </div>
            ) : null}
            {job.notes ? (
              <div>
                <p className="cg-eyebrow">Notes</p>
                <p className="mt-1 whitespace-pre-line text-steel-300">{job.notes}</p>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Documents"
          description="Quotes and invoices raised for this job"
          action={
            <Link
              href={`/app/quotes/new?jobId=${job.id}`}
              className="text-xs font-semibold uppercase tracking-wide text-ember-300 hover:text-ember-200"
            >
              New quote
            </Link>
          }
        />
        <CardBody className="space-y-3 text-sm">
          {quotes.length === 0 ? (
            <p className="text-steel-400">
              No quotes on this job yet. The job already carries the customer, site address and
              description, so a quote from here needs only the lines and prices.
            </p>
          ) : (
            <ul className="divide-y divide-ink-800">
              {quotes.map((quote) => (
                <li key={quote.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div>
                    <Link
                      href={`/app/quotes/${quote.id}`}
                      className="font-mono text-sm text-paper hover:text-ember-300"
                    >
                      {quote.quote_number}
                    </Link>
                    <p className="text-xs text-steel-500">
                      Issued {formatDate(quote.issue_date)}
                      {quote.valid_until ? ` · valid until ${formatDate(quote.valid_until)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={effectiveQuoteStatus(quote.status, quote.valid_until)} />
                    <span className="font-mono text-sm text-paper">
                      {formatCurrency(quote.total, session.currencyCode)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {job.invoice_count > 0 ? (
            <p className="text-xs text-steel-500">
              {job.invoice_count} invoice(s) on this job — payments land on the invoice, not the job.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Job history" description="Every change to this job" />
        <CardBody>
          {activity.length === 0 ? (
            <p className="text-sm text-steel-500">Nothing recorded yet.</p>
          ) : (
            <ol className="space-y-3">
              {activity.map((event) => (
                <li key={event.id} className="flex gap-3">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ember-500" />
                  <div>
                    <p className="text-sm text-steel-300">
                      {humaniseEnum(event.event_type.split('.').slice(1).join(' ') || event.event_type)}
                      {event.metadata && typeof event.metadata === 'object' && 'to' in event.metadata
                        ? ` → ${humaniseEnum(String((event.metadata as { to?: string }).to))}`
                        : ''}
                      {event.actor_name ? ` · ${event.actor_name}` : ''}
                    </p>
                    <p className="text-xs text-steel-500">{formatDateTime(event.created_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </>
  );
}
