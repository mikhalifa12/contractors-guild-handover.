import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CustomerForm } from '@/components/forms/customer-forms';

export const metadata: Metadata = { title: 'New customer' };

export default function NewCustomerPage() {
  return (
    <>
      <header>
        <Link href="/app/customers" className="cg-eyebrow hover:text-paper">
          ← Customers
        </Link>
        <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">New customer</h1>
        <p className="mt-1.5 text-sm text-steel-500">
          Only the name and one contact method are required — everything else can be filled in later.
        </p>
      </header>

      <Alert tone="info" title="Your data stays yours">
        <p>
          Customer records are isolated to your business at the database level. No other contractor
          can read them.
        </p>
      </Alert>

      <Card>
        <CardHeader title="Customer details" description="Contact, billing address and job site" />
        <CardBody>
          <CustomerForm />
        </CardBody>
      </Card>
    </>
  );
}
