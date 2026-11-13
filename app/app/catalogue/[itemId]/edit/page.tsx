import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CatalogueItemForm } from '@/components/forms/catalogue-forms';
import { requireSession } from '@/lib/auth/current-user';
import { getCatalogueItem } from '@/lib/repositories/catalogue';
import { formatDateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Edit catalogue item' };
export const dynamic = 'force-dynamic';

export default async function EditCatalogueItemPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const session = await requireSession();
  const { itemId } = await params;
  const item = await getCatalogueItem(session.businessId, session.userId, itemId);

  if (!item) notFound();

  return (
    <>
      <header>
        <Link href="/app/catalogue" className="cg-eyebrow hover:text-paper">
          ← Products &amp; services
        </Link>
        <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">{item.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-steel-500">
          <Badge tone={item.kind === 'SERVICE' ? 'info' : 'ember'}>{item.kind}</Badge>
          {item.is_active ? null : <Badge tone="warning">Archived</Badge>}
          <span>Last updated {formatDateTime(item.updated_at)}</span>
        </div>
      </header>

      <Card>
        <CardHeader title="Item details" description="Service or product, priced per unit" />
        <CardBody>
          <CatalogueItemForm item={item} />
        </CardBody>
      </Card>
    </>
  );
}
