'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requestMetadata, requireSession } from '@/lib/auth/current-user';
import {
  createCatalogueItem,
  setCatalogueItemArchived,
  updateCatalogueItem,
  type CatalogueInput,
} from '@/lib/repositories/catalogue';
import { catalogueItemSchema, nullish } from '@/lib/validation/schemas';
import {
  errorState,
  fieldErrorsFromZod,
  readString,
  unexpectedError,
  type ActionState,
} from '@/lib/actions/state';

/**
 * Catalogue (products and services) Server Actions.
 *
 * A catalogue item is a template: quotes and invoices copy its values onto
 * their own line items, so changing a price here never changes an issued
 * document.
 */
function parseItem(formData: FormData) {
  return catalogueItemSchema.safeParse({
    kind: readString(formData, 'kind') || 'SERVICE',
    name: readString(formData, 'name'),
    description: readString(formData, 'description'),
    category: readString(formData, 'category'),
    unit: readString(formData, 'unit') || 'each',
    sku: readString(formData, 'sku'),
    defaultPrice: readString(formData, 'defaultPrice'),
    costPrice: readString(formData, 'costPrice'),
    taxRate: readString(formData, 'taxRate') || '15',
    isActive: readString(formData, 'isActive') || 'false',
  });
}

function toRepositoryInput(data: NonNullable<ReturnType<typeof parseItem>['data']>): CatalogueInput {
  return {
    kind: data.kind,
    name: data.name,
    description: nullish(data.description),
    category: nullish(data.category),
    unit: data.unit,
    sku: nullish(data.sku),
    defaultPrice: data.defaultPrice,
    costPrice: nullish(data.costPrice),
    taxRate: data.taxRate,
    isActive: data.isActive,
  };
}

export async function createCatalogueItemAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();
  const parsed = parseItem(formData);

  if (!parsed.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(parsed.error));
  }

  try {
    const metadata = await requestMetadata();
    const result = await createCatalogueItem(
      session.businessId,
      session.userId,
      toRepositoryInput(parsed.data),
      { ipAddress: metadata.ipAddress }
    );

    if (!result.ok) {
      if (result.reason === 'duplicate_name') {
        return errorState(
          `“${parsed.data.name}” is already in your catalogue. Edit that entry instead, or use a different name.`,
          { name: ['An item with this name already exists'] },
          'duplicate_name'
        );
      }
      return errorState('The item could not be saved. Please try again.');
    }
  } catch (error) {
    return unexpectedError('catalogue.create', error);
  }

  revalidatePath('/app/catalogue');
  redirect('/app/catalogue?saved=1');
}

export async function updateCatalogueItemAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();
  const itemId = readString(formData, 'itemId');
  const parsed = parseItem(formData);

  if (!itemId) return errorState('Missing item reference. Reload the page and try again.');
  if (!parsed.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(parsed.error));
  }

  try {
    const metadata = await requestMetadata();
    const result = await updateCatalogueItem(
      session.businessId,
      session.userId,
      itemId,
      toRepositoryInput(parsed.data),
      { ipAddress: metadata.ipAddress }
    );

    if (!result.ok) {
      if (result.reason === 'duplicate_name') {
        return errorState('Another catalogue item already uses that name.', {
          name: ['An item with this name already exists'],
        });
      }
      return errorState('That catalogue item no longer exists in your business.');
    }
  } catch (error) {
    return unexpectedError('catalogue.update', error);
  }

  revalidatePath('/app/catalogue');
  redirect('/app/catalogue?saved=1');
}

/** Archive hides an item from pickers without touching historical documents. */
export async function setCatalogueItemArchivedAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const itemId = readString(formData, 'itemId');
  const archived = readString(formData, 'archived') === '1';

  if (!itemId) redirect('/app/catalogue');

  try {
    const metadata = await requestMetadata();
    await setCatalogueItemArchived(session.businessId, session.userId, itemId, archived, {
      ipAddress: metadata.ipAddress,
    });
  } catch (error) {
    unexpectedError('catalogue.archive', error);
    redirect('/app/catalogue?error=1');
  }

  revalidatePath('/app/catalogue');
  redirect(`/app/catalogue?${archived ? 'archived' : 'restored'}=1`);
}
