import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { JobForm } from '@/components/forms/job-forms';
import { requireSession } from '@/lib/auth/current-user';
import { listCustomerOptions } from '@/lib/repositories/customers';
import { humaniseEnum } from '@/lib/format';

export const metadata: Metadata = { title: 'New job' };
export const dynamic = 'force-dynamic';

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;

  const customers = await listCustomerOptions(session.businessId, session.userId);
  const options = customers.map((customer) => ({
    value: customer.id,
    label: customer.business_name,
    hint: [humaniseEnum(customer.customer_type), customer.billing_city, customer.phone]
      .filter(Boolean)
      .join(' · '),
  }));

  return (
    <>
      <header>
        <Link href="/app/jobs" className="cg-eyebrow hover:text-paper">
          ← Jobs
        </Link>
        <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">New job</h1>
        <p className="mt-1.5 text-sm text-steel-500">
          Job numbers are allocated automatically and cannot be duplicated.
        </p>
      </header>

      {customers.length === 0 ? (
        <Alert tone="warning" title="Add a customer first">
          <p>
            A job belongs to a customer.{' '}
            <Link href="/app/customers/new" className="font-semibold underline">
              Add a customer
            </Link>{' '}
            — it takes a few seconds — then come back.
          </p>
        </Alert>
      ) : (
        <Card>
          <CardHeader title="Job details" description="Who it is for, what needs doing, when" />
          <CardBody>
            <JobForm
              customers={options}
              job={{
                customerId: params.customerId ?? '',
                title: '',
                description: null,
                jobType: null,
                status: 'LEAD',
                scheduledDate: null,
                jobAddressLine1: null,
                jobAddressLine2: null,
                jobCity: null,
                jobProvince: null,
                jobPostalCode: null,
                notes: null,
              }}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}
