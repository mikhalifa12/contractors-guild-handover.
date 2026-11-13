'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requestMetadata, requireSession } from '@/lib/auth/current-user';
import {
  createCustomer,
  findPossibleDuplicate,
  setCustomerArchived,
  updateCustomer,
  type CustomerInput,
} from '@/lib/repositories/customers';
import { customerSchema, nullish } from '@/lib/validation/schemas';
import {
  errorState,
  fieldErrorsFromZod,
  readString,
  unexpectedError,
  type ActionState,
} from '@/lib/actions/state';

/**
 * Customer Server Actions.
 *
 * The business id always comes from the server-side session: a form field can
 * never choose which business is written to (there is a test for that).
 */
function parseCustomer(formData: FormData) {
  return customerSchema.safeParse({
    customerType: readString(formData, 'customerType') || 'BUSINESS',
    businessName: readString(formData, 'businessName'),
    contactPerson: readString(formData, 'contactPerson'),
    phone: readString(formData, 'phone'),
    email: readString(formData, 'email'),
    billingAddressLine1: readString(formData, 'billingAddressLine1'),
    billingAddressLine2: readString(formData, 'billingAddressLine2'),
    billingCity: readString(formData, 'billingCity'),
    billingProvince: readString(formData, 'billingProvince'),
    billingPostalCode: readString(formData, 'billingPostalCode'),
    billingCountry: readString(formData, 'billingCountry') || 'South Africa',
    siteAddressLine1: readString(formData, 'siteAddressLine1'),
    siteAddressLine2: readString(formData, 'siteAddressLine2'),
    siteCity: readString(formData, 'siteCity'),
    siteProvince: readString(formData, 'siteProvince'),
    sitePostalCode: readString(formData, 'sitePostalCode'),
    notes: readString(formData, 'notes'),
  });
}

function toRepositoryInput(data: ReturnType<typeof customerSchema.parse>): CustomerInput {
  return {
    customerType: data.customerType,
    businessName: data.businessName,
    contactPerson: nullish(data.contactPerson),
    phone: nullish(data.phone),
    email: nullish(data.email),
    billingAddressLine1: nullish(data.billingAddressLine1),
    billingAddressLine2: nullish(data.billingAddressLine2),
    billingCity: nullish(data.billingCity),
    billingProvince: nullish(data.billingProvince),
    billingPostalCode: nullish(data.billingPostalCode),
    billingCountry: nullish(data.billingCountry),
    siteAddressLine1: nullish(data.siteAddressLine1),
    siteAddressLine2: nullish(data.siteAddressLine2),
    siteCity: nullish(data.siteCity),
    siteProvince: nullish(data.siteProvince),
    sitePostalCode: nullish(data.sitePostalCode),
    notes: nullish(data.notes),
  };
}

export async function createCustomerAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();
  const parsed = parseCustomer(formData);

  if (!parsed.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(parsed.error));
  }

  const input = toRepositoryInput(parsed.data);
  let customerId: string;

  try {
    // Warning, not a block: two customers can legitimately share a name, but
    // the form should not create an accidental second record with one tap.
    if (readString(formData, 'confirmDuplicate') !== '1') {
      const duplicate = await findPossibleDuplicate(
        session.businessId,
        session.userId,
        input.businessName,
        input.phone
      );
      if (duplicate) {
        return errorState(
          `“${duplicate.business_name}” may already exist in your customer list. Open that customer, or choose “Save anyway” to add a separate record.`,
          { businessName: ['A customer with this name or phone number already exists'] },
          'duplicate_customer'
        );
      }
    }

    const metadata = await requestMetadata();
    const created = await createCustomer(session.businessId, session.userId, input, {
      ipAddress: metadata.ipAddress,
    });
    customerId = created.id;
  } catch (error) {
    return unexpectedError('customer.create', error);
  }

  revalidatePath('/app/customers');
  revalidatePath('/app');
  redirect(`/app/customers/${customerId}`);
}

export async function updateCustomerAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();
  const customerId = readString(formData, 'customerId');
  const parsed = parseCustomer(formData);

  if (!customerId) return errorState('Missing customer reference. Reload the page and try again.');
  if (!parsed.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(parsed.error));
  }

  try {
    const metadata = await requestMetadata();
    const result = await updateCustomer(
      session.businessId,
      session.userId,
      customerId,
      toRepositoryInput(parsed.data),
      { ipAddress: metadata.ipAddress }
    );

    if (!result.updated) {
      return errorState('That customer no longer exists in your business.');
    }
  } catch (error) {
    return unexpectedError('customer.update', error);
  }

  revalidatePath('/app/customers');
  revalidatePath(`/app/customers/${customerId}`);
  redirect(`/app/customers/${customerId}?saved=1`);
}

/**
 * Archive/restore. Archived customers keep their history and can be restored;
 * nothing is deleted, because jobs and documents reference them.
 */
export async function setCustomerArchivedAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const customerId = readString(formData, 'customerId');
  const archived = readString(formData, 'archived') === '1';

  if (!customerId) redirect('/app/customers');

  try {
    const metadata = await requestMetadata();
    await setCustomerArchived(session.businessId, session.userId, customerId, archived, {
      ipAddress: metadata.ipAddress,
    });
  } catch (error) {
    unexpectedError('customer.archive', error);
    redirect(`/app/customers/${customerId}?error=1`);
  }

  revalidatePath('/app/customers');
  revalidatePath(`/app/customers/${customerId}`);
  redirect(`/app/customers/${customerId}?${archived ? 'archived' : 'restored'}=1`);
}
