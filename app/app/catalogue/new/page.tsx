import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CatalogueItemForm } from '@/components/forms/catalogue-forms';

export const metadata: Metadata = { title: 'New catalogue item' };

export default function NewCatalogueItemPage() {
  return (
    <>
      <header>
        <Link href="/app/catalogue" className="cg-eyebrow hover:text-paper">
          ← Products &amp; services
        </Link>
        <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">New catalogue item</h1>
        <p className="mt-1.5 text-sm text-steel-500">
          Enter prices excluding VAT. Your VAT rate is filled in from your business settings.
        </p>
      </header>

      <Alert tone="info" title="How the catalogue is used">
        <p>
          Quotes and invoices copy the values from here onto their own lines, so changing a price
          later never changes a document you already sent.
        </p>
      </Alert>

      <Card>
        <CardHeader title="Item details" description="Service or product, priced per unit" />
        <CardBody>
          <CatalogueItemForm />
        </CardBody>
      </Card>
    </>
  );
}
