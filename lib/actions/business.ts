'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth/current-user';
import { getStorage, logoStorageKey, validateLogoUpload } from '@/lib/storage';
import {
  getBusinessLogoKey,
  setBusinessLogo,
  updateBusinessBanking,
  updateBusinessProfile,
  updateBusinessSettings,
} from '@/lib/repositories/businesses';
import {
  businessBankingSchema,
  businessDocumentSettingsSchema,
  businessProfileSchema,
  nullish,
} from '@/lib/validation/schemas';
import {
  errorState,
  fieldErrorsFromZod,
  readString,
  successState,
  unexpectedError,
  type ActionState,
} from '@/lib/actions/state';

/**
 * Business profile, document settings and banking details.
 *
 * Every action resolves the business id from the server-side session. A form
 * field or URL parameter can never select which business is written to.
 */
export async function saveBusinessProfileAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();

  const parsed = businessProfileSchema.safeParse({
    legalName: readString(formData, 'legalName'),
    tradingName: readString(formData, 'tradingName'),
    registrationNumber: readString(formData, 'registrationNumber'),
    taxNumber: readString(formData, 'taxNumber'),
    addressLine1: readString(formData, 'addressLine1'),
    addressLine2: readString(formData, 'addressLine2'),
    city: readString(formData, 'city'),
    province: readString(formData, 'province'),
    postalCode: readString(formData, 'postalCode'),
    country: readString(formData, 'country') || 'South Africa',
    phone: readString(formData, 'phone'),
    email: readString(formData, 'email'),
    website: readString(formData, 'website'),
    whatsapp: readString(formData, 'whatsapp'),
  });

  if (!parsed.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(parsed.error));
  }

  const input = parsed.data;

  try {
    await updateBusinessProfile(session.businessId, session.userId, {
      legalName: input.legalName,
      tradingName: nullish(input.tradingName),
      registrationNumber: nullish(input.registrationNumber),
      taxNumber: nullish(input.taxNumber),
      addressLine1: nullish(input.addressLine1),
      addressLine2: nullish(input.addressLine2),
      city: nullish(input.city),
      province: nullish(input.province),
      postalCode: nullish(input.postalCode),
      country: input.country,
      phone: nullish(input.phone),
      email: nullish(input.email),
      website: nullish(input.website),
      whatsapp: nullish(input.whatsapp),
    });
  } catch (error) {
    return unexpectedError('saveBusinessProfile', error);
  }

  revalidatePath('/app/settings');
  revalidatePath('/app/onboarding');
  return successState('Business details saved.');
}

export async function saveDocumentSettingsAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();

  const parsed = businessDocumentSettingsSchema.safeParse({
    defaultPaymentTerms: readString(formData, 'defaultPaymentTerms'),
    defaultQuoteValidityDays: readString(formData, 'defaultQuoteValidityDays'),
    defaultTaxRate: readString(formData, 'defaultTaxRate'),
    quotePrefix: readString(formData, 'quotePrefix'),
    invoicePrefix: readString(formData, 'invoicePrefix'),
    receiptPrefix: readString(formData, 'receiptPrefix'),
    invoiceFooterNote: readString(formData, 'invoiceFooterNote'),
  });

  if (!parsed.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(parsed.error));
  }

  try {
    await updateBusinessSettings(session.businessId, session.userId, {
      defaultPaymentTerms: parsed.data.defaultPaymentTerms,
      defaultQuoteValidityDays: parsed.data.defaultQuoteValidityDays,
      defaultTaxRate: parsed.data.defaultTaxRate,
      quotePrefix: parsed.data.quotePrefix,
      invoicePrefix: parsed.data.invoicePrefix,
      receiptPrefix: parsed.data.receiptPrefix,
      invoiceFooterNote: nullish(parsed.data.invoiceFooterNote),
    });
  } catch (error) {
    return unexpectedError('saveDocumentSettings', error);
  }

  revalidatePath('/app/settings/documents');
  return successState('Document settings saved.');
}

/**
 * Banking details belong to the business, are entered by the owner and are
 * stored in the database. They are never read from source code or environment
 * files, and they are never shown on a public (customer-facing) page.
 */
export async function saveBankingDetailsAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();

  const parsed = businessBankingSchema.safeParse({
    bankName: readString(formData, 'bankName'),
    bankAccountName: readString(formData, 'bankAccountName'),
    bankAccountNumber: readString(formData, 'bankAccountNumber'),
    bankBranchCode: readString(formData, 'bankBranchCode'),
    bankAccountType: readString(formData, 'bankAccountType'),
    paymentInstructions: readString(formData, 'paymentInstructions'),
  });

  if (!parsed.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(parsed.error));
  }

  try {
    await updateBusinessBanking(session.businessId, session.userId, {
      bankName: nullish(parsed.data.bankName),
      bankAccountName: nullish(parsed.data.bankAccountName),
      bankAccountNumber: nullish(parsed.data.bankAccountNumber),
      bankBranchCode: nullish(parsed.data.bankBranchCode),
      bankAccountType: nullish(parsed.data.bankAccountType),
      paymentInstructions: nullish(parsed.data.paymentInstructions),
    });
  } catch (error) {
    return unexpectedError('saveBankingDetails', error);
  }

  revalidatePath('/app/settings/banking');
  return successState('Banking details saved.');
}

export async function uploadLogoAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();

  const file = formData.get('logo');
  if (!(file instanceof File)) {
    return errorState('Choose an image file to upload.', { logo: ['Choose an image file.'] });
  }

  const validated = await validateLogoUpload(file);
  if (!validated.ok) {
    return errorState(validated.error, { logo: [validated.error] });
  }

  try {
    const storage = getStorage();
    const previousKey = await getBusinessLogoKey(session.businessId, session.userId);
    const key = logoStorageKey(session.businessId, validated.extension);

    await storage.save(key, validated.data, validated.contentType);
    await setBusinessLogo(session.businessId, session.userId, {
      storageKey: key,
      contentType: validated.contentType,
    });

    if (previousKey && previousKey !== key) {
      await storage.remove(previousKey);
    }
  } catch (error) {
    return unexpectedError('uploadLogo', error);
  }

  revalidatePath('/app/settings');
  return successState('Logo updated.');
}

export async function removeLogoAction(
  _previous: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const session = await requireSession();

  try {
    const storage = getStorage();
    const previousKey = await getBusinessLogoKey(session.businessId, session.userId);
    await setBusinessLogo(session.businessId, session.userId, null);
    if (previousKey) await storage.remove(previousKey);
  } catch (error) {
    return unexpectedError('removeLogo', error);
  }

  revalidatePath('/app/settings');
  return successState('Logo removed.');
}
