import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { JobForm } from '@/components/forms/job-forms';
import { requireSession } from '@/lib/auth/current-user';
import { getJob } from '@/lib/repositories/jobs';
import { listCustomerOptions } from '@/lib/repositories/customers';
import { humaniseEnum } from '@/lib/format';

export const metadata: Metadata = { title: 'Edit job' };
export const dynamic = 'force-dynamic';

export default async function EditJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const session = await requireSession();
  const { jobId } = await params;

  const [job, customers] = await Promise.all([
    getJob(session.businessId, session.userId, jobId),
    listCustomerOptions(session.businessId, session.userId),
  ]);

  if (!job) notFound();

  const options = customers.map((customer) => ({
    value: customer.id,
    label: customer.business_name,
    hint: [humaniseEnum(customer.customer_type), customer.billing_city, customer.phone]
      .filter(Boolean)
      .join(' · '),
  }));

  // An archived or historical customer must still be selectable on its own job.
  if (!options.some((option) => option.value === job.customer_id)) {
    options.unshift({
      value: job.customer_id,
      label: job.customer_name,
      hint: 'Current customer (archived)',
    });
  }

  return (
    <>
      <header>
        <Link href={`/app/jobs/${job.id}`} className="cg-eyebrow hover:text-paper">
          ← {job.job_number}
        </Link>
        <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">Edit job</h1>
        <div className="mt-2 flex items-center gap-2 text-xs text-steel-500">
          <StatusBadge status={job.status} />
          <span>
            Status is changed from the job screen so the pipeline history stays accurate.
          </span>
        </div>
      </header>

      <Card>
        <CardHeader title="Job details" description="Who it is for, what needs doing, when" />
        <CardBody>
          <JobForm
            customers={options}
            job={{
              id: job.id,
              customerId: job.customer_id,
              title: job.title,
              description: job.description,
              jobType: job.job_type,
              status: job.status,
              scheduledDate: job.scheduled_date,
              jobAddressLine1: job.job_address_line1,
              jobAddressLine2: job.job_address_line2,
              jobCity: job.job_city,
              jobProvince: job.job_province,
              jobPostalCode: job.job_postal_code,
              notes: job.notes,
            }}
          />
        </CardBody>
      </Card>
    </>
  );
}
