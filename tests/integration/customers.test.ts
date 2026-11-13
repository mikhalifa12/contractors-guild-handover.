import '@/tests/helpers/env';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const mocks = await import('@/tests/helpers/next-mocks');
  return {
    cookies: async () => mocks.cookieStore,
    headers: async () => mocks.headersList,
  };
});

vi.mock('next/navigation', async () => {
  const mocks = await import('@/tests/helpers/next-mocks');
  return {
    redirect: (url: string): never => {
      throw new mocks.RedirectSignal(url);
    },
  };
});

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

import {
  createCustomerAction,
  setCustomerArchivedAction,
  updateCustomerAction,
} from '@/lib/actions/customers';
import {
  countCustomers,
  getCustomer,
  getCustomerHistory,
  listCustomerOptions,
  listCustomers,
} from '@/lib/repositories/customers';
import { clearRateLimits } from '@/lib/security/rate-limit';
import { expectRedirect, formData, runAction, runFormAction } from '@/tests/helpers/actions';
import { registerOwner } from '@/tests/helpers/owners';
import { countRows, resetDatabase, withAdminClient } from '@/tests/helpers/env';

function customerForm(overrides: Record<string, string> = {}) {
  return formData({
    customerType: 'BUSINESS',
    businessName: 'Harbour Point Body Corporate',
    contactPerson: 'Riaan Fourie',
    phone: '021 555 0110',
    email: 'riAan@Example.co.za',
    billingAddressLine1: '1 Harbour Road',
    billingCity: 'Cape Town',
    billingProvince: 'Western Cape',
    billingPostalCode: '8001',
    billingCountry: 'South Africa',
    siteAddressLine1: 'Block C plant room',
    siteCity: 'Cape Town',
    sitePostalCode: '8001',
    notes: 'Gate code 4417',
    ...overrides,
  });
}

/**
 * Create a customer through the real Server Action. Registration already put a
 * live session in the cookie jar, so the action runs exactly as it would for a
 * signed-in contractor.
 */
async function createCustomerThroughAction(overrides: Record<string, string> = {}) {
  const outcome = await runAction(createCustomerAction, customerForm(overrides));
  expectRedirect(outcome, '/app/customers/');
  if (outcome.kind !== 'redirect') throw new Error('unreachable');
  const customerId = outcome.url.replace('/app/customers/', '').split('?')[0];
  if (!customerId) throw new Error('No customer id in redirect');
  return customerId;
}

describe('customers', () => {
  beforeEach(async () => {
    clearRateLimits();
    await resetDatabase();
  });

  it('creates a customer through the real action and stores normalised data', async () => {
    const owner = await registerOwner();

    const customerId = await createCustomerThroughAction();

    const customer = await getCustomer(owner.businessId, owner.userId, customerId);
    expect(customer).not.toBeNull();
    expect(customer?.business_name).toBe('Harbour Point Body Corporate');
    expect(customer?.email).toBe('riaan@example.co.za'); // lower-cased by the schema
    expect(customer?.contact_person).toBe('Riaan Fourie');
    expect(customer?.site_address_line1).toBe('Block C plant room');
    expect(customer?.is_active).toBe(true);

    // An audit event is written in the same transaction as the insert.
    expect(
      await countRows('audit_events', `event_type = 'customer.created' and entity_id = $1`, [customerId])
    ).toBe(1);
  });

  it('rejects a customer with no way to make contact', async () => {
    await registerOwner();


    const outcome = await runAction(
      createCustomerAction,
      customerForm({ phone: '', email: '' })
    );

    if (outcome.kind !== 'state' || outcome.state.status !== 'error') {
      throw new Error('Expected a validation error');
    }
    expect(outcome.state.fieldErrors.phone?.length).toBeGreaterThan(0);
    expect(await countRows('customers')).toBe(0);
  });

  it('warns about a possible duplicate but still allows a deliberate second record', async () => {
    await registerOwner();
    await createCustomerThroughAction();

    const duplicate = await runAction(createCustomerAction, customerForm());
    if (duplicate.kind !== 'state' || duplicate.state.status !== 'error') {
      throw new Error('Expected a duplicate warning');
    }
    expect(duplicate.state.code).toBe('duplicate_customer');

    const forced = await runAction(
      createCustomerAction,
      customerForm({ confirmDuplicate: '1' })
    );
    expectRedirect(forced, '/app/customers/');
    expect(await countRows('customers')).toBe(2);
  });

  it('updates a customer and keeps the change auditable', async () => {
    const owner = await registerOwner();
    const customerId = await createCustomerThroughAction();

    const outcome = await runAction(
      updateCustomerAction,
      customerForm({
        customerId,
        businessName: 'Harbour Point Body Corporate (Head Office)',
        phone: '021 555 0199',
      })
    );
    expectRedirect(outcome, `/app/customers/${customerId}?saved=1`);

    const customer = await getCustomer(owner.businessId, owner.userId, customerId);
    expect(customer?.business_name).toBe('Harbour Point Body Corporate (Head Office)');
    expect(customer?.phone).toBe('021 555 0199');
    expect(
      await countRows('audit_events', `event_type = 'customer.updated' and entity_id = $1`, [customerId])
    ).toBe(1);
  });

  it('archives and restores without losing the record', async () => {
    const owner = await registerOwner();
    const customerId = await createCustomerThroughAction();

    const archived = await runFormAction(
      setCustomerArchivedAction,
      formData({ customerId, archived: '1' })
    );
    expectRedirect(archived, `/app/customers/${customerId}?archived=1`);

    const afterArchive = await getCustomer(owner.businessId, owner.userId, customerId);
    expect(afterArchive?.is_active).toBe(false);

    // Archived customers disappear from pickers and from the default list.
    expect(await listCustomerOptions(owner.businessId, owner.userId)).toHaveLength(0);
    const activeList = await listCustomers(owner.businessId, owner.userId, { status: 'active' });
    expect(activeList.rows).toHaveLength(0);
    const allList = await listCustomers(owner.businessId, owner.userId, { status: 'all' });
    expect(allList.rows).toHaveLength(1);

    const restored = await runFormAction(
      setCustomerArchivedAction,
      formData({ customerId, archived: '0' })
    );
    expectRedirect(restored, `/app/customers/${customerId}?restored=1`);
    expect((await getCustomer(owner.businessId, owner.userId, customerId))?.is_active).toBe(true);
  });

  it('searches by name, phone and email, and paginates', async () => {
    const owner = await registerOwner();
    await createCustomerThroughAction({ businessName: 'Table Bay Coffee Roasters' });
    await createCustomerThroughAction({
      businessName: 'Naledi Mokoena',
      customerType: 'INDIVIDUAL',
      phone: '082 555 0142',
      email: 'naledi@example.co.za',
      confirmDuplicate: '1',
    });
    await createCustomerThroughAction({
      businessName: 'Sunset Electrical Supplies',
      phone: '021 555 0177',
      email: 'sales@example.co.za',
      confirmDuplicate: '1',
    });

    const byName = await listCustomers(owner.businessId, owner.userId, { search: 'coffee' });
    expect(byName.rows.map((row) => row.business_name)).toEqual(['Table Bay Coffee Roasters']);

    const byPhone = await listCustomers(owner.businessId, owner.userId, { search: '082 555' });
    expect(byPhone.rows).toHaveLength(1);
    expect(byPhone.rows[0]?.business_name).toBe('Naledi Mokoena');

    const byEmail = await listCustomers(owner.businessId, owner.userId, { search: 'example.co.za' });
    expect(byEmail.total).toBe(3);

    const firstPage = await listCustomers(owner.businessId, owner.userId, { limit: 2 });
    expect(firstPage.rows).toHaveLength(2);
    expect(firstPage.total).toBe(3);
    const secondPage = await listCustomers(owner.businessId, owner.userId, { limit: 2, offset: 2 });
    expect(secondPage.rows).toHaveLength(1);
  });

  it('reports real counts and an empty document history', async () => {
    const owner = await registerOwner();
    const customerId = await createCustomerThroughAction();

    const history = await getCustomerHistory(owner.businessId, owner.userId, customerId);
    expect(history.jobs).toEqual([]);
    expect(history.quotes).toEqual([]);
    expect(history.invoices).toEqual([]);
    expect(history.payments).toEqual([]);

    const detail = await getCustomer(owner.businessId, owner.userId, customerId);
    expect(detail?.job_count).toBe(0);
    expect(detail?.outstanding).toBe('0.00');
    expect(Number(detail?.paid_total)).toBe(0);

    const counts = await countCustomers(owner.businessId, owner.userId);
    expect(counts).toEqual({ total: 1, active: 1 });
  });

  it('never writes to another business, even when the form supplies a foreign id', async () => {
    const first = await registerOwner();
    const firstCustomerId = await createCustomerThroughAction(first);

    await registerOwner();

    // The second owner tries to update and archive the first owner's customer
    // by submitting its id. Both calls must be no-ops for them.
    const update = await runAction(
      updateCustomerAction,
      customerForm({ customerId: firstCustomerId, businessName: 'Hijacked' })
    );
    if (update.kind !== 'state' || update.state.status !== 'error') {
      throw new Error('Expected the foreign update to be refused');
    }

    await runFormAction(setCustomerArchivedAction, formData({ customerId: firstCustomerId, archived: '1' }));

    const untouched = await withAdminClient(async (client) => {
      const { rows } = await client.query<{ business_name: string; is_active: boolean }>(
        'select business_name, is_active from public.customers where id = $1',
        [firstCustomerId]
      );
      return rows[0];
    });

    expect(untouched?.business_name).toBe('Harbour Point Body Corporate');
    expect(untouched?.is_active).toBe(true);
  });

  it('does not list another business\'s customers', async () => {
    const first = await registerOwner();
    await createCustomerThroughAction(first);

    const second = await registerOwner();

    const list = await listCustomers(second.businessId, second.userId, {});
    expect(list.rows).toHaveLength(0);
    expect(list.total).toBe(0);

    // …and the second owner's own list stays empty.
    expect((await countCustomers(second.businessId, second.userId)).total).toBe(0);
  });
});
