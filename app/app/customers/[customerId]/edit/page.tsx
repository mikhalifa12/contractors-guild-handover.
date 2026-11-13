import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CustomerForm } from '@/components/forms/customer-forms';
import { requireSession } from '@/lib/auth/current-user';
import { getCustomer } from '@/lib/repositories/customers';

export const metadata: Metadata = { title: 'Edit customer' };
export const dynamic = 'force-dynamic';

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const session = await requireSession();
  const { customerId } = await params;
  const customer = await getCustomer(session.businessId, session.userId, customerId);

  if (!customer) notFound();

  return (
    <>
      <header>
        <Link href={`/app/customers/${customer.id}`} className="cg-eyebrow hover:text-paper">
          ← {customer.business_name}
        </Link>
        <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">Edit customer</h1>
        <p className="mt-1.5 text-sm text-steel-500">
          Changes apply to future documents only — issued quotes and invoices keep the details they
          were created with.
        </p>
      </header>

      <Card>
        <CardHeader title="Customer details" description="Contact, billing address and job site" />
        <CardBody>
          <CustomerForm
            customer={{
              id: customer.id,
              customerType: customer.customer_type,
              businessName: customer.business_name,
              contactPerson: customer.contact_person,
              phone: customer.phone,
              email: customer.email,
              billingAddressLine1: customer.billing_address_line1,
              billingAddressLine2: customer.billing_address_line2,
              billingCity: customer.billing_city,
              billingProvince: customer.billing_province,
              billingPostalCode: customer.billing_postal_code,
              billingCountry: customer.billing_country,
              siteAddressLine1: customer.site_address_line1,
              siteAddressLine2: customer.site_address_line2,
              siteCity: customer.site_city,
              siteProvince: customer.site_province,
              sitePostalCode: customer.site_postal_code,
              notes: customer.notes,
            }}
          />
        </CardBody>
      </Card>
    </>
  );
}
